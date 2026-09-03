import test from "node:test";
import assert from "node:assert/strict";

import { Container } from "../di/container.ts";
import { registerCoreRepositories } from "../di/register-core.ts";
import {
  DATASET_REPO,
  IDB,
  KEY_VALUE_STORE,
  NOTIFIER,
  PULL_SERVICE,
  RUN_SCOPE_FACTORY,
  RUN_STATE_REPO,
  SETTINGS_REPO,
  SN_REMOTE,
  SN_REMOTE_FACTORY
} from "../di/tokens.ts";
import { createMemoryDatabase } from "../data/idb.ts";
import { createMemoryKeyValueStore } from "../data/key-value-store.ts";
import { CachedTicketRepository } from "../data/repositories/ticket-repository.ts";
import { CachedTimelineRepository } from "../data/repositories/timeline-repository.ts";
import { FakeSnRemote } from "../data/datasource/sn-remote.ts";
import { MSG } from "../lib/keys.ts";
import { PullService } from "../services/pull-service.ts";
import { scopeGroups } from "../services/queue-scope.ts";

const INSTANCE = "https://dev385266.service-now.com";
const QUEUES = ["Queue A"];
const TABLE = "incident";
const QUERY = "assignment_group.nameINQueue A";

/**
 * Wires the real PullService to fake storage and a scripted remote.
 *
 * Nothing here mocks an extension API or IndexedDB — that is the whole point of
 * putting repositories behind interfaces.
 */
function harness(remote: FakeSnRemote, params: Record<string, unknown> = {}) {
  const c = new Container();
  c.registerValue(KEY_VALUE_STORE, createMemoryKeyValueStore());
  c.registerValue(IDB, createMemoryDatabase());
  const sent: Record<string, unknown>[] = [];
  c.registerValue(NOTIFIER, (msg: Record<string, unknown>) => {
    sent.push(msg);
  });
  registerCoreRepositories(c);

  c.registerValue(SN_REMOTE_FACTORY, () => remote);
  c.register(RUN_SCOPE_FACTORY, (container) => async () => {
    const child = container.child();
    child.registerValue(SN_REMOTE, remote);
    return {
      tickets: new CachedTicketRepository(remote, container.resolve(IDB)),
      timelines: new CachedTimelineRepository(remote, container.resolve(IDB))
    };
  });
  c.registerClass(PULL_SERVICE, PullService, { singleton: true });

  const settings = c.resolve(SETTINGS_REPO);
  const stored = {
    version: 2,
    instanceUrl: INSTANCE,
    defaults: { queues: QUEUES, teamMembers: ["Alice", "Bob"] },
    params: { ...params }
  };

  const progress: { stage: string; detail: string }[] = [];
  const run = async (extra: Record<string, unknown> = {}) => {
    await settings.save(stored);
    return c.resolve(PULL_SERVICE).run({
      instanceUrl: INSTANCE,
      groups: QUEUES,
      fields: ["sys_id"],
      onProgress: (stage, detail) => progress.push({ stage, detail }),
      ...extra
    });
  };

  return { c, settings, run, progress, sent, remote };
}

function ticket(sysId: string, number: string, updatedOn = "2026-01-01 10:00:00") {
  return {
    sys_id: sysId,
    number,
    state: "Closed",
    opened_at: { value: "2026-01-01 09:00:00", display_value: "2026-01-01 09:00:00" },
    sys_updated_on: { value: updatedOn, display_value: updatedOn },
    assignment_group: { value: "", display_value: "Queue A" },
    work_notes: ""
  };
}

test("a pull fetches, analyses, persists and broadcasts", async () => {
  const remote = new FakeSnRemote();
  remote.counts[`${TABLE}|${QUERY}`] = 1;
  remote.records[`${TABLE}|${QUERY}`] = [ticket("abc", "INC001")];
  remote.timelines.abc = [
    { field: "assignment_group", oldValue: "", newValue: "Queue A", at: "2026-01-01 09:30:00" },
    { field: "assigned_to", oldValue: "", newValue: "Alice", at: "2026-01-01 09:45:00" }
  ];

  const { run, c, sent } = harness(remote);
  const result = await run();

  assert.equal(result.pulled, 1);
  assert.equal(result.total, 1);
  assert.deepEqual(result.skipped, []);

  const dataset = await c.resolve(DATASET_REPO).load();
  assert.equal(dataset?.rows.length, 1);
  assert.equal(dataset?.rows[0].number, "INC001");
  assert.ok(dataset?.rows[0].assignTimeUtcIso, "queue entry produced an assign time");
  assert.ok(dataset?.rows[0].acknTimeUtcIso, "team-member assignment produced an ackn time");

  const lastRun = await c.resolve(RUN_STATE_REPO).load();
  assert.equal(lastRun?.tickets, 1);
  assert.equal(lastRun?.group, "Queue A");

  assert.deepEqual(sent, [{ type: MSG.dataUpdated }]);
});

test("a second pull merges into the existing dataset rather than replacing it", async () => {
  const remote = new FakeSnRemote();
  remote.counts[`${TABLE}|${QUERY}`] = 1;
  remote.records[`${TABLE}|${QUERY}`] = [ticket("abc", "INC001")];
  remote.timelines.abc = [
    { field: "assignment_group", oldValue: "", newValue: "Queue A", at: "2026-01-01 09:30:00" }
  ];

  const { run, c, remote: r } = harness(remote, { cacheTtlMinutes: 0 });
  await run();

  r.records[`${TABLE}|${QUERY}`] = [ticket("abc", "INC001"), ticket("def", "INC002")];
  r.counts[`${TABLE}|${QUERY}`] = 2;
  r.timelines.def = [
    { field: "assignment_group", oldValue: "", newValue: "Queue A", at: "2026-01-02 09:30:00" }
  ];

  const second = await run();
  assert.equal(second.total, 2, "merged, not replaced");

  const dataset = await c.resolve(DATASET_REPO).load();
  assert.deepEqual(dataset?.rows.map((r) => r.number).sort(), ["INC001", "INC002"]);
  assert.equal(dataset?.runs.length, 2);
});

test("a filter set over the max-tickets limit is skipped and reported", async () => {
  const remote = new FakeSnRemote();
  remote.counts[`${TABLE}|${QUERY}`] = 50;

  const { run, progress } = harness(remote, { maxTicketsPerPull: 10 });

  await assert.rejects(
    run(),
    /No tickets match this filter list/,
    "every set skipped means there is nothing to persist"
  );

  assert.ok(
    progress.some((p) => p.stage === "limit" && p.detail.includes("LIMIT")),
    "the skip is surfaced to the user"
  );
});

test("a pull with no queues configured fails with actionable guidance", async () => {
  const remote = new FakeSnRemote();
  const { run } = harness(remote);
  await assert.rejects(run({ groups: [] }), /No queues configured/);
});

test("a queue name containing a comma is rejected", async () => {
  const remote = new FakeSnRemote();
  const { run } = harness(remote);
  await assert.rejects(run({ groups: ["Queue A, Queue B"] }), /contains a comma/);
});

test("scopeGroups dedupes and trims", () => {
  assert.deepEqual(scopeGroups(["  A  ", "A", "B", "", null]), ["A", "B"]);
  assert.deepEqual(scopeGroups([{ name: "From object" }]), ["From object"]);
});

test("progress is reported through the documented stages", async () => {
  const remote = new FakeSnRemote();
  remote.counts[`${TABLE}|${QUERY}`] = 1;
  remote.records[`${TABLE}|${QUERY}`] = [ticket("abc", "INC001")];
  remote.timelines.abc = [
    { field: "assignment_group", oldValue: "", newValue: "Queue A", at: "2026-01-01 09:30:00" }
  ];

  const { run, progress } = harness(remote);
  await run();

  const stages = [...new Set(progress.map((p) => p.stage))];
  for (const expected of ["resolve", "count", "phase1", "phase2", "analyze", "done"]) {
    assert.ok(stages.includes(expected), `expected a "${expected}" progress stage`);
  }
});

test("change summary pull issues two scoped change_request requests (last + next week)", async () => {
  const remote = new FakeSnRemote();
  remote.counts[`${TABLE}|${QUERY}`] = 1;
  remote.records[`${TABLE}|${QUERY}`] = [ticket("abc", "INC001")];
  remote.timelines.abc = [
    { field: "assignment_group", oldValue: "", newValue: "Queue A", at: "2026-01-01 09:30:00" }
  ];

  const { run, remote: r } = harness(remote);
  await run({ includeChangeSummary: true });

  const crCounts = r.calls.filter((c) => c.method === "count" && c.args[0] === "change_request");
  assert.equal(crCounts.length, 2, "one count per week window (last, next)");

  for (const c of crCounts) {
    const q = String(c.args[1]);
    // Scope applied exactly once per request — no repetition, no top-level OR.
    assert.equal((q.match(/assignment_group\.nameINQueue A/g) || []).length, 1, `scope once in ${q}`);
    assert.equal((q.match(/\^OR/g) || []).length, 0, "no top-level OR in a single-window query");
    assert.ok(q.includes("start_dateBETWEEN"), "filters on start_date BETWEEN a window");
    assert.ok(q.includes("gs.dateGenerate"), "uses instance-side date generation");
  }
  // The two windows must differ (last vs next week).
  assert.notEqual(String(crCounts[0].args[1]), String(crCounts[1].args[1]), "last and next week windows differ");
});

test("change summary pull persists change rows onto the dataset", async () => {
  const remote = new FakeSnRemote();
  remote.counts[`${TABLE}|${QUERY}`] = 1;
  remote.records[`${TABLE}|${QUERY}`] = [ticket("abc", "INC001")];
  remote.timelines.abc = [
    { field: "assignment_group", oldValue: "", newValue: "Queue A", at: "2026-01-01 09:30:00" }
  ];

  const { run, c, remote: r } = harness(remote);
  const crQueries = [];
  const origCount = r.count.bind(r);
  r.count = async (table, qq) => {
    if (table === "change_request") crQueries.push(qq);
    return origCount(table, qq);
  };
  await run({ includeChangeSummary: true });
  assert.ok(crQueries.length >= 1, "learned the change_request queries");
  // Seed a response on the first (last-week) window.
  r.counts[`change_request|${crQueries[0]}`] = 1;
  r.records[`change_request|${crQueries[0]}`] = [
    { sys_id: "chg1", number: "CHG100", state: "Closed", cmdb_ci: { display_value: "RMS (prd)" }, short_description: "x" }
  ];
  await run({ includeChangeSummary: true });

  const dataset = await c.resolve(DATASET_REPO).load();
  assert.ok(Array.isArray(dataset?.changeSummaryRows), "changeSummaryRows persisted");
  assert.equal(dataset?.changeSummaryRows?.[0]?.number, "CHG100");
});

test("a cached second run makes no ticket or timeline requests", async () => {
  const remote = new FakeSnRemote();
  remote.counts[`${TABLE}|${QUERY}`] = 1;
  remote.records[`${TABLE}|${QUERY}`] = [ticket("abc", "INC001")];
  remote.timelines.abc = [
    { field: "assignment_group", oldValue: "", newValue: "Queue A", at: "2026-01-01 09:30:00" }
  ];

  const { run, remote: r } = harness(remote);
  await run();

  const callsAfterFirst = r.calls.length;
  await run();

  const afterSecond = r.calls.slice(callsAfterFirst);
  assert.equal(
    afterSecond.filter((c) => c.method !== "count").length,
    0,
    `expected no fetches on a cached re-run, got ${JSON.stringify(afterSecond)}`
  );
});

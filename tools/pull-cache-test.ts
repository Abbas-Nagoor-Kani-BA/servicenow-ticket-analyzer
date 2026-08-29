import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryDatabase } from "../data/idb.ts";
import { FakeSnRemote } from "../data/datasource/sn-remote.ts";
import { CachedTicketRepository, isFreshQuery, queryKey } from "../data/repositories/ticket-repository.ts";
import {
  CachedTimelineRepository,
  timelineNeedsFetch
} from "../data/repositories/timeline-repository.ts";

const TABLE = "incident";
const QUERY = "assignment_group.nameINQueue A";

function setup(ttlMinutes = 15) {
  const db = createMemoryDatabase();
  const remote = new FakeSnRemote();
  const repo = new CachedTicketRepository(remote, db);
  repo.setQueryTtlMinutes(ttlMinutes);
  return { db, remote, repo };
}

test("queryKey is stable, table-sensitive and collision-free", () => {
  assert.equal(queryKey(TABLE, QUERY), queryKey(TABLE, QUERY));
  assert.notEqual(queryKey("incident", QUERY), queryKey("problem", QUERY));
  assert.notEqual(queryKey(TABLE, "a"), queryKey(TABLE, "b"));
  assert.match(queryKey(TABLE, QUERY), /^[0-9a-f]{8}-[0-9a-f]{8}$/);

  const keys = new Set(Array.from({ length: 2000 }, (_, i) => queryKey("incident", `x=${i}`)));
  assert.equal(keys.size, 2000);
});

test("isFreshQuery follows the documented rules", () => {
  const now = Date.now();
  const ttl = 15 * 60 * 1000;

  assert.equal(isFreshQuery(null), false, "no entry");
  assert.equal(isFreshQuery({ at: now - 1000, records: [1] } as never, now), true, "fresh");
  assert.equal(isFreshQuery({ at: now - ttl, records: [1] } as never, now), false, "exactly at the TTL is stale");
  assert.equal(isFreshQuery({ at: now - ttl - 1, records: [1] } as never, now), false, "expired");
  assert.equal(isFreshQuery({ at: now } as never, now), false, "records must be an array");
  assert.equal(new CachedTicketRepository(new FakeSnRemote(), createMemoryDatabase()).getQueryTtlMs(), ttl);
});

test("first list hits the remote and populates the cache", async () => {
  const { db, remote, repo } = setup();
  remote.records[`${TABLE}|${QUERY}`] = [{ sys_id: "1" }, { sys_id: "2" }];

  const result = await repo.list({ table: TABLE, encodedQuery: QUERY, fields: ["sys_id"] });

  assert.equal(result.source, "remote");
  assert.equal(result.records.length, 2);
  assert.equal(remote.calls.length, 1);
  assert.ok(await db.store("queries").get(queryKey(TABLE, QUERY)));
});

test("second list is served from cache with no remote call", async () => {
  const { remote, repo } = setup();
  remote.records[`${TABLE}|${QUERY}`] = [{ sys_id: "1" }];

  await repo.list({ table: TABLE, encodedQuery: QUERY, fields: ["sys_id"] });
  const second = await repo.list({ table: TABLE, encodedQuery: QUERY, fields: ["sys_id"] });

  assert.equal(second.source, "cache");
  assert.ok(second.cachedAt);
  assert.equal(remote.calls.length, 1);
});

test("a stale entry falls back to the remote", async () => {
  const { db, remote, repo } = setup(15);
  await db.store("queries").put(queryKey(TABLE, QUERY), {
    at: Date.now() - 16 * 60 * 1000,
    table: TABLE,
    query: QUERY,
    records: [{ sys_id: "old" }]
  });
  remote.records[`${TABLE}|${QUERY}`] = [{ sys_id: "fresh" }];

  const result = await repo.list({ table: TABLE, encodedQuery: QUERY, fields: ["sys_id"] });

  assert.equal(result.source, "remote");
  assert.deepEqual(result.records, [{ sys_id: "fresh" }]);
});

test("a zero TTL disables query caching", async () => {
  const { remote, repo } = setup(0);
  remote.records[`${TABLE}|${QUERY}`] = [{ sys_id: "1" }];

  await repo.list({ table: TABLE, encodedQuery: QUERY, fields: ["sys_id"] });
  const second = await repo.list({ table: TABLE, encodedQuery: QUERY, fields: ["sys_id"] });

  assert.equal(second.source, "remote");
  assert.equal(remote.calls.length, 2);
});

test("purgeExpired drops stale query entries and keeps fresh ones", async () => {
  const { db, repo } = setup(15);
  const store = db.store("queries");
  await store.put("fresh", { at: Date.now(), table: TABLE, query: QUERY, records: [] });
  await store.put("stale", { at: Date.now() - 20 * 60 * 1000, table: TABLE, query: QUERY, records: [] });

  await repo.purgeExpired();

  assert.ok(await store.get("fresh"));
  assert.equal(await store.get("stale"), undefined);
});

test("timelineNeedsFetch follows the documented rules", () => {
  const entry = { at: Date.now(), updatedAt: "2026-01-01 10:00:00", events: [{ field: "state" }] };

  assert.equal(timelineNeedsFetch(undefined, "2026-01-01 10:00:00"), true, "no cached entry");
  assert.equal(timelineNeedsFetch({ ...entry, events: undefined as never }, "x"), true, "events not an array");
  assert.equal(timelineNeedsFetch(entry, ""), false, "no watermark means trust the cache");
  assert.equal(timelineNeedsFetch(entry, "2026-01-02 10:00:00"), true, "ticket newer than cache");
  assert.equal(timelineNeedsFetch(entry, "2025-12-31 10:00:00"), false, "ticket older than cache");
});

test("timeline repository reuses cached events and fetches only the rest", async () => {
  const db = createMemoryDatabase();
  const remote = new FakeSnRemote();
  const repo = new CachedTimelineRepository(remote, db);

  await db.store("timelines").put("incident:a", {
    at: Date.now(),
    updatedAt: "2026-01-01 10:00:00",
    events: [{ field: "state" }]
  });
  remote.timelines.c = [{ field: "assigned_to" }];

  const result = await repo.getMany({
    table: "incident",
    tickets: [
      { sysId: "a", updatedOn: "2026-01-01 10:00:00" },
      { sysId: "b", updatedOn: "2026-01-01 10:00:00" },
      { sysId: "c", updatedOn: "2026-01-05 10:00:00" }
    ]
  });

  assert.deepEqual([...result.events.keys()].sort(), ["a", "c"], "b has no events anywhere");
  assert.equal(result.events.get("a")?.length, 1);
  assert.equal(result.reused, 1, "only the cached ticket was reused");
  assert.equal(result.fetched, 2, "b and c needed a request");

  const fetchedIds = remote.calls.find((c) => c.method === "fetchTimelineEvents")?.args[0] as string[];
  assert.deepEqual(fetchedIds, ["b", "c"], "cached ticket is not re-fetched");
});

test("timeline repository persists fetched events with the watermark", async () => {
  const db = createMemoryDatabase();
  const remote = new FakeSnRemote();
  const repo = new CachedTimelineRepository(remote, db);
  remote.timelines.a = [{ field: "state" }];

  await repo.getMany({
    table: "incident",
    tickets: [{ sysId: "a", updatedOn: "2026-03-03 09:00:00" }]
  });

  const stored = await db.store("timelines").get<any>("incident:a");
  assert.equal(stored.updatedAt, "2026-03-03 09:00:00");
  assert.equal(stored.events.length, 1);

  remote.calls.length = 0;
  await repo.getMany({
    table: "incident",
    tickets: [{ sysId: "a", updatedOn: "2026-03-03 09:00:00" }]
  });
  assert.equal(remote.calls.length, 0, "same watermark needs no refetch");
});

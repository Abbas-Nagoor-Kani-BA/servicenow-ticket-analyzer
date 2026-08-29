import test from "node:test";
import assert from "node:assert/strict";

import { Container } from "../di/container.ts";
import { registerCoreRepositories } from "../di/register-core.ts";
import {
  DATASET_REPO,
  EXPORT_CONFIG_REPO,
  FILTER_LIST_REPO,
  KEY_VALUE_STORE,
  NOTIFIER,
  RUN_STATE_REPO,
  SETTINGS_REPO,
  TEMPLATE_REPO,
  VIEWER_PREFS_REPO
} from "../di/tokens.ts";
import { createMemoryKeyValueStore } from "../data/key-value-store.ts";
import { MSG } from "../lib/keys.ts";
import { normalizeCiSplit } from "../data/repositories/export-config-repository.ts";

function testContainer(): Container {
  const c = new Container();
  c.registerValue(KEY_VALUE_STORE, createMemoryKeyValueStore());
  return registerCoreRepositories(c);
}

test("settings repository round-trips and notifies", async () => {
  const repo = testContainer().resolve(SETTINGS_REPO);
  assert.equal(await repo.load(), null);

  const seen: unknown[] = [];
  const off = repo.onChange((s) => seen.push(s));

  await repo.save({ version: 2, instanceUrl: "https://x.service-now.com", defaults: { queues: ["A"] } });

  const loaded = await repo.load();
  assert.equal(loaded?.instanceUrl, "https://x.service-now.com");
  assert.deepEqual(loaded?.defaults.queues, ["A"]);
  assert.equal(seen.length, 1);

  off();
  await repo.save({ version: 2, instanceUrl: "https://y.service-now.com", defaults: {} });
  assert.equal(seen.length, 1);
});

test("dataset repository saves, clears and broadcasts", async () => {
  const sent: Record<string, unknown>[] = [];
  const c = new Container();
  c.registerValue(KEY_VALUE_STORE, createMemoryKeyValueStore());
  c.registerValue(NOTIFIER, (msg: Record<string, unknown>) => {
    sent.push(msg);
  });
  const repo = registerCoreRepositories(c).resolve(DATASET_REPO);

  const dataset = {
    at: "2026-01-01T00:00:00.000Z",
    instance: "https://x.service-now.com",
    missingAudit: 0,
    totalPulled: 1,
    runs: [],
    rows: [{ sysId: "1", number: "INC001" }]
  };

  await repo.save(dataset);
  assert.equal((await repo.load())?.rows.length, 1);

  await repo.broadcastChanged();
  assert.deepEqual(sent, [{ type: MSG.dataUpdated }]);

  await repo.clear();
  assert.equal(await repo.load(), null);
});

test("dataset repository reports external writes via onChange", async () => {
  const store = createMemoryKeyValueStore();
  const c = new Container();
  c.registerValue(KEY_VALUE_STORE, store);
  const repo = registerCoreRepositories(c).resolve(DATASET_REPO);

  const seen: unknown[] = [];
  repo.onChange((d) => seen.push(d));

  store.emitExternal("lastData", { at: "x", rows: [] });
  assert.equal(seen.length, 1);
});

test("run-state repository round-trips", async () => {
  const c = testContainer();
  const repo = c.resolve(RUN_STATE_REPO);
  await repo.save({ at: "t", instance: "i", query: "q", group: "g", tickets: 3 });
  assert.equal((await repo.load())?.tickets, 3);
});

test("export config normalises legacy and malformed CI split", async () => {
  const c = testContainer();
  const repo = c.resolve(EXPORT_CONFIG_REPO);

  assert.deepEqual(await repo.loadCiSplit(), { enabled: false, groups: [] });

  await repo.saveCiSplit({ enabled: true, groups: [] });
  assert.equal((await repo.loadCiSplit()).enabled, true);

  // legacy flat `items` shape
  assert.deepEqual(normalizeCiSplit({ enabled: true, items: ["ci-a", "ci-b", "  "] }), {
    enabled: true,
    groups: [
      { name: "ci-a", items: ["ci-a"] },
      { name: "ci-b", items: ["ci-b"] }
    ]
  });

  assert.deepEqual(normalizeCiSplit(null), { enabled: false, groups: [] });
  assert.deepEqual(normalizeCiSplit("garbage"), { enabled: false, groups: [] });

  await repo.saveColumnMap({ E: "number" });
  assert.deepEqual(await repo.loadColumnMap(), { E: "number" });
});

test("viewer prefs default cleanly and coerce junk", async () => {
  const c = testContainer();
  const repo = c.resolve(VIEWER_PREFS_REPO);

  assert.deepEqual(await repo.loadAll(), {
    selection: null,
    hiddenCols: [],
    colWidths: {},
    msrLists: null
  });

  await repo.saveSelection({ a: "1", f: "2" });
  await repo.saveHiddenCols(["number"]);
  await repo.saveColWidths({ number: 120, bad: "nope" });

  const prefs = await repo.loadAll();
  assert.deepEqual(prefs.selection, { a: "1", f: "2" });
  assert.deepEqual(prefs.hiddenCols, ["number"]);
  assert.deepEqual(prefs.colWidths, { number: 120 });

  await repo.saveSelection(null);
  assert.equal((await repo.loadAll()).selection, null);
});

test("template and filter-list repositories round-trip", async () => {
  const c = testContainer();

  const templates = c.resolve(TEMPLATE_REPO);
  assert.equal(await templates.load(), null);
  await templates.save({ base64: "AAA", name: "msr.xlsx", at: "t" });
  assert.equal((await templates.load())?.name, "msr.xlsx");
  await templates.clear();
  assert.equal(await templates.load(), null);

  const filters = c.resolve(FILTER_LIST_REPO);
  assert.deepEqual(await filters.load(), []);
  await filters.save([{ table: "incident", conditions: [] }, null as never, "junk" as never]);
  assert.equal((await filters.load()).length, 1);
  await filters.clear();
  assert.deepEqual(await filters.load(), []);
});

test("repositories are singletons per container", () => {
  const c = testContainer();
  assert.equal(c.resolve(SETTINGS_REPO), c.resolve(SETTINGS_REPO));
  assert.notEqual(c.resolve(SETTINGS_REPO), c.child().resolve(SETTINGS_REPO));
});

test("a child overriding the store gets a repository bound to it", async () => {
  const root = new Container();
  root.registerValue(KEY_VALUE_STORE, createMemoryKeyValueStore({ pluginSettings: { version: 9 } }));
  const rootRepo = registerCoreRepositories(root).resolve(SETTINGS_REPO);

  const childStore = createMemoryKeyValueStore();
  const child = root.child();
  child.registerValue(KEY_VALUE_STORE, childStore);
  const childRepo = child.resolve(SETTINGS_REPO);

  assert.notEqual(childRepo, rootRepo);
  assert.equal((await rootRepo.load())?.version, 9);
  assert.equal(await childRepo.load(), null);

  await childRepo.save({ version: 1, instanceUrl: "https://child", defaults: {} });
  assert.equal(await childRepo.load() !== null, true);
  assert.equal((await rootRepo.load())?.version, 9);
});

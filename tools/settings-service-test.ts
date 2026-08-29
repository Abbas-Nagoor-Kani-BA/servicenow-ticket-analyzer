import test from "node:test";
import assert from "node:assert/strict";

import { Container } from "../di/container.ts";
import { SETTINGS_REPO, KEY_VALUE_STORE, MSR_LISTS_REPO } from "../di/tokens.ts";
import { createMemoryKeyValueStore } from "../data/key-value-store.ts";
import { normaliseSettings, SettingsService, SETTINGS_DEFAULTS } from "../services/settings-service.ts";
import { SettingsStore } from "../data/repositories/settings-repository.ts";
import { MsrListsStore } from "../data/repositories/msr-lists-repository.ts";

test("normaliseSettings fills every field from defaults", () => {
  const draft = normaliseSettings(null);
  assert.equal(draft.version, 2);
  assert.equal(draft.instanceUrl, "");
  assert.deepEqual(draft.defaults.queues, []);
  assert.equal(draft.params.tablePageSize, 1000);
  assert.equal(draft.params.cacheTtlMinutes, 15);
  assert.equal(draft.params.maxTicketsPerPull, 500);
  assert.equal(draft.params.debugResponses, false);
});

test("normaliseSettings keeps valid values", () => {
  const draft = normaliseSettings({
    instanceUrl: "https://dev385266.service-now.com",
    defaults: { ticketType: "problem", queues: ["Queue A"], teamMembers: ["Alice"] },
    params: { tablePageSize: 500, cacheTtlMinutes: 30, maxTicketsPerPull: 50, debugResponses: true }
  });
  assert.equal(draft.instanceUrl, "https://dev385266.service-now.com");
  assert.equal(draft.defaults.ticketType, "problem");
  assert.deepEqual(draft.defaults.queues, ["Queue A"]);
  assert.equal(draft.params.tablePageSize, 500);
  assert.equal(draft.params.debugResponses, true);
});

test("normaliseSettings migrates the legacy single queueName", () => {
  const draft = normaliseSettings({ defaults: { queueName: "Legacy Queue" } });
  assert.deepEqual(draft.defaults.queues, ["Legacy Queue"]);
});

test("normaliseSettings ignores queueName when queues already exist", () => {
  const draft = normaliseSettings({ defaults: { queueName: "Legacy", queues: ["Current"] } });
  assert.deepEqual(draft.defaults.queues, ["Current"]);
});

test("normaliseSettings rejects an unknown ticket type", () => {
  assert.equal(normaliseSettings({ defaults: { ticketType: "not_a_table" } }).defaults.ticketType, "incident");
});

test("normaliseSettings clamps every numeric param", () => {
  const low = normaliseSettings({ params: { tablePageSize: 1, cacheTtlMinutes: -5, maxTicketsPerPull: -1 } });
  assert.equal(low.params.tablePageSize, 100, "tablePageSize floor");
  assert.equal(low.params.cacheTtlMinutes, 0, "cacheTtlMinutes floor");
  assert.equal(low.params.maxTicketsPerPull, 0, "maxTicketsPerPull floor");

  const high = normaliseSettings({ params: { tablePageSize: 999999, cacheTtlMinutes: 999999, maxTicketsPerPull: 999999 } });
  assert.equal(high.params.tablePageSize, 5000);
  assert.equal(high.params.cacheTtlMinutes, 10080);
  assert.equal(high.params.maxTicketsPerPull, 100000);
});

test("normaliseSettings coerces junk params back to defaults", () => {
  const draft = normaliseSettings({ params: { tablePageSize: "abc", maxTicketsPerPull: undefined } });
  assert.equal(draft.params.tablePageSize, SETTINGS_DEFAULTS.params.tablePageSize);
  assert.equal(draft.params.maxTicketsPerPull, SETTINGS_DEFAULTS.params.maxTicketsPerPull);
});

test("an empty cache TTL field means 0, which disables caching", () => {
  // Preserved from the original page: an empty number input has value "",
  // Number("") is 0, and 0 is the documented "cache disabled" setting. It must
  // not silently fall back to the 15 minute default.
  assert.equal(normaliseSettings({ params: { cacheTtlMinutes: "" } }).params.cacheTtlMinutes, 0);
  assert.equal(normaliseSettings({ params: { cacheTtlMinutes: null } }).params.cacheTtlMinutes, 0);
});

test("normaliseSettings coerces debugResponses to a boolean", () => {
  assert.equal(normaliseSettings({ params: { debugResponses: "yes" } }).params.debugResponses, true);
  assert.equal(normaliseSettings({ params: { debugResponses: 0 } }).params.debugResponses, false);
});

test("normaliseSettings does not mutate the defaults object", () => {
  normaliseSettings({ instanceUrl: "https://x", params: { cacheTtlMinutes: 60 } });
  assert.equal(SETTINGS_DEFAULTS.params.cacheTtlMinutes, 15);
  assert.equal(SETTINGS_DEFAULTS.instanceUrl, "");
});

test("SettingsService round-trips through the repository", async () => {
  const c = new Container();
  c.registerValue(KEY_VALUE_STORE, createMemoryKeyValueStore());
  c.registerClass(SETTINGS_REPO, SettingsStore);
  c.registerClass(MSR_LISTS_REPO, MsrListsStore);
  const service = new SettingsService(c.resolve(SETTINGS_REPO));

  assert.deepEqual((await service.load()).defaults.queues, [], "missing settings yield defaults");

  await service.save({
    ...SETTINGS_DEFAULTS,
    instanceUrl: "https://saved",
    defaults: { ticketType: "incident", queues: ["Queue A"], teamMembers: [] }
  });

  assert.equal((await service.load()).instanceUrl, "https://saved");

  const reset = await service.reset();
  assert.equal(reset.instanceUrl, "");
  assert.equal((await service.load()).instanceUrl, "");
});

test("SettingsService merges MSR lists over the built-in defaults", () => {
  const service = new SettingsService(new SettingsStore(createMemoryKeyValueStore()));
  const merged = service.msrLists({ lists: { resolution: ["Custom fix"] } });
  assert.deepEqual(merged.resolution, ["Custom fix"]);
  assert.ok(Array.isArray(merged.opCo), "untouched keys keep their defaults");
  assert.ok(merged.opCo.length > 0);
});

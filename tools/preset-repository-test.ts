import { test } from "node:test";
import assert from "node:assert/strict";

import { PresetStore, WSR_PRESET_VALUE } from "../data/repositories/preset-repository.ts";
import { createMemoryKeyValueStore } from "../data/key-value-store.ts";

const sampleSets = [
  { table: "incident", conditions: [{ join: "AND", field: "state", oper: "eq", value: "2", value2: "" }] }
];

test("add then load round-trips a preset", async () => {
  const kv = createMemoryKeyValueStore();
  const repo = new PresetStore(kv);
  assert.equal(await repo.add("My preset", sampleSets), "added");
  const loaded = await repo.load();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, "My preset");
  assert.deepEqual(loaded[0].sets, sampleSets);
});

test("blank name is rejected", async () => {
  const repo = new PresetStore(createMemoryKeyValueStore());
  assert.equal(await repo.add("   ", sampleSets), "empty-name");
  assert.equal((await repo.load()).length, 0);
});

test("duplicate name (case-insensitive) is rejected and not re-added", async () => {
  const repo = new PresetStore(createMemoryKeyValueStore());
  assert.equal(await repo.add("Weekly", sampleSets), "added");
  assert.equal(await repo.add("weekly", sampleSets), "duplicate");
  assert.equal((await repo.load()).length, 1);
});

test("names shadowing the built-in WSR are reserved", async () => {
  const repo = new PresetStore(createMemoryKeyValueStore());
  assert.equal(await repo.add("WSR", sampleSets), "reserved");
  assert.equal(await repo.add(WSR_PRESET_VALUE, sampleSets), "reserved");
  assert.equal((await repo.load()).length, 0);
});

test("remove drops a preset by name", async () => {
  const repo = new PresetStore(createMemoryKeyValueStore());
  await repo.add("A", sampleSets);
  await repo.add("B", sampleSets);
  await repo.remove("a");
  const names = (await repo.load()).map((p) => p.name);
  assert.deepEqual(names, ["B"]);
});

test("data persists across a fresh store over the same key-value backing", async () => {
  const kv = createMemoryKeyValueStore();
  await new PresetStore(kv).add("Persisted", sampleSets);
  const reopened = await new PresetStore(kv).load();
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].name, "Persisted");
});

test("load ignores malformed entries", async () => {
  const kv = createMemoryKeyValueStore({ snFilterPresets: [{ name: "ok", sets: [] }, { nope: 1 }, null, { name: "x" }] });
  const loaded = await new PresetStore(kv).load();
  assert.deepEqual(loaded.map((p) => p.name), ["ok"]);
});

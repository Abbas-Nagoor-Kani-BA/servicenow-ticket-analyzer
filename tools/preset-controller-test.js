import { test } from "node:test";
import assert from "node:assert/strict";

import { presetOptions, resolvePresetSets } from "../core/preset-controller.ts";
import { WSR_PRESET_VALUE } from "../data/repositories/preset-repository.ts";

const NOW = new Date(2026, 8, 3, 10, 0, 0);
const userPresets = [
  { name: "My open incidents", sets: [{ table: "incident", conditions: [{ join: "AND", field: "state", oper: "eq", value: "2", value2: "" }] }] },
  { name: "Closed problems", sets: [{ table: "problem", conditions: [{ join: "AND", field: "problem_state", oper: "eq", value: "157", value2: "" }] }] }
];

test("presetOptions lists WSR first, then user presets in order", () => {
  const opts = presetOptions(userPresets);
  assert.deepEqual(opts, [
    { value: WSR_PRESET_VALUE, label: "WSR" },
    { value: "My open incidents", label: "My open incidents" },
    { value: "Closed problems", label: "Closed problems" }
  ]);
});

test("presetOptions with no user presets is just WSR", () => {
  assert.deepEqual(presetOptions([]), [{ value: WSR_PRESET_VALUE, label: "WSR" }]);
});

test("resolvePresetSets(WSR) synthesizes the 7 WSR sets", () => {
  const sets = resolvePresetSets(WSR_PRESET_VALUE, userPresets, NOW);
  assert.equal(sets.length, 7);
  assert.equal(sets[0].table, "incident");
});

test("resolvePresetSets(userName) returns that preset's stored sets", () => {
  assert.deepEqual(resolvePresetSets("Closed problems", userPresets, NOW), userPresets[1].sets);
});

test("resolvePresetSets(unknown) returns empty", () => {
  assert.deepEqual(resolvePresetSets("nope", userPresets, NOW), []);
});

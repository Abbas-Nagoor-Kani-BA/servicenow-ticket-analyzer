import { test } from "node:test";
import assert from "node:assert/strict";

import { isScTask, displayNumber, priorityCell } from "../core/rowfields.ts";

test("isScTask detects SCTASK numbers only", () => {
  assert.equal(isScTask({ number: "SCTASK0012345" }), true);
  assert.equal(isScTask({ number: "sctask0012345" }), true);
  assert.equal(isScTask({ number: "INC0012345" }), false);
  assert.equal(isScTask({ number: "REQ0012345" }), false);
  assert.equal(isScTask({ number: "PRB0012345" }), false);
  assert.equal(isScTask({}), false);
});

test("displayNumber returns the RITM number for sc_task", () => {
  assert.equal(displayNumber({ number: "SCTASK0001", requestItem: "RITM0012345" }), "RITM0012345");
});

test("displayNumber falls back to SCTASK number when no request item", () => {
  assert.equal(displayNumber({ number: "SCTASK0001", requestItem: "" }), "SCTASK0001");
  assert.equal(displayNumber({ number: "SCTASK0001" }), "SCTASK0001");
});

test("displayNumber leaves other ticket types unchanged", () => {
  assert.equal(displayNumber({ number: "INC0001", requestItem: "RITM0009" }), "INC0001");
  assert.equal(displayNumber({ number: "PRB0001" }), "PRB0001");
});

test("priorityCell is RFS for sc_task, passthrough otherwise", () => {
  assert.equal(priorityCell({ number: "SCTASK0001", priority: "3 - Moderate" }), "RFS");
  assert.equal(priorityCell({ number: "INC0001", priority: "2 - High" }), "2 - High");
  assert.equal(priorityCell({ number: "PRB0001", priority: 1 }), "1");
  assert.equal(priorityCell({ number: "INC0001" }), "");
});

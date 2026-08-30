import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFillGrid,
  originRowValues,
  parseClipboardBlock,
  storedValue
} from "../surfaces/viewer/paste.js";

test("parseClipboardBlock handles tab-separated blocks and trims", () => {
  const out = parseClipboardBlock("a\tb\nc\td\n");
  assert.deepEqual(out, [["a", "b"], ["c", "d"]]);
});

test("parseClipboardBlock falls back to comma and single-column splitting", () => {
  assert.deepEqual(parseClipboardBlock("x,y\nz,w"), [["x", "y"], ["z", "w"]]);
  assert.deepEqual(parseClipboardBlock("one\ntwo"), [["one"], ["two"]]);
});

test("parseClipboardBlock pads ragged rows to uniform width and drops empty rows", () => {
  const out = parseClipboardBlock("a\tb\nd\n\n");
  assert.deepEqual(out, [["a", "b"], ["d", ""]]);
});

test("parseClipboardBlock returns null for empty input", () => {
  assert.equal(parseClipboardBlock(null), null);
  assert.equal(parseClipboardBlock(""), null);
  assert.equal(parseClipboardBlock("  "), null);
});

test("buildFillGrid tiles a 1x1 source across the whole target", () => {
  const out = buildFillGrid([["v"]], 3, 2);
  assert.deepEqual(out, [["v", "v"], ["v", "v"], ["v", "v"]]);
});

test("buildFillGrid tiles a 1xN row downward", () => {
  const out = buildFillGrid([["a", "b"]], 3, 2);
  assert.deepEqual(out, [["a", "b"], ["a", "b"], ["a", "b"]]);
});

test("buildFillGrid tiles an NxM block by modulo and clips when source is larger", () => {
  const out = buildFillGrid([["a", "b"], ["c", "d"]], 3, 3);
  assert.deepEqual(out, [["a", "b", "a"], ["c", "d", "c"], ["a", "b", "a"]]);
});

test("storedValue returns a plain string for non-date non-picker columns", () => {
  const row = {};
  assert.equal(storedValue("  hello  ", "shortDescription", "", row, {}), "  hello  ");
});

test("storedValue parses inst columns to ISO via deps.parseLocal", () => {
  const row = {};
  const parseLocal = t => {
    if (t === "01-08-2026 10:00:00") return new Date("2026-08-01T10:00:00Z");
    if (t === "2026-08-01 10:00:00") return new Date("2026-08-01T10:00:00Z");
    return null;
  };
  assert.equal(storedValue("01-08-2026 10:00:00", "assignTimeUtcIso", "inst", row, { parseLocal }),
    "2026-08-01T10:00:00.000Z");
  assert.equal(storedValue("", "assignTimeUtcIso", "inst", row, { parseLocal }), "");
  assert.equal(storedValue("garbage-not-a-date", "assignTimeUtcIso", "inst", row, { parseLocal }),
    "garbage-not-a-date");
});

test("storedValue matches picker column against option list case-insensitively", () => {
  const listFor = (key, row) => key === "solutionType" ? ["Permanent fix", "Workaround"] : null;
  assert.equal(storedValue("  workaround ", "solutionType", "", {}, { listFor }), "Workaround");
  assert.equal(storedValue("Permanent fix", "solutionType", "", {}, { listFor }), "Permanent fix");
});

test("storedValue keeps raw value when not in the option list", () => {
  const listFor = (key) => key === "solutionType" ? ["Permanent fix"] : null;
  assert.equal(storedValue("Custom value", "solutionType", "", {}, { listFor }), "Custom value");
});

test("originRowValues extracts the origin row's stored values across the column span", () => {
  const rows = [{ a: "x", b: "y", c: "z" }];
  const cols = [["a"], ["b"], ["c"]];
  assert.deepEqual(originRowValues(rows, cols, 0, 0, 2), ["x", "y", "z"]);
});

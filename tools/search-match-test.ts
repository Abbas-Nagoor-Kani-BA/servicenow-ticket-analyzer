import { test } from "node:test";
import assert from "node:assert/strict";

import { rowMatches } from "../surfaces/viewer/search-match.ts";
import type { SearchColumn } from "../surfaces/viewer/search-match.ts";

const COLUMNS: SearchColumn[] = [
  ["number", "Number", "num", 120],
  ["state", "State", "", 105],
  ["assignTimeUtcIso", "Assign time", "inst", 155],
  ["rep:type", "Type", "rep", 85],
  ["dur:assignToAckn", "Time to ackn", "dur", 120]
];

// Fake resolver: models displayed/export values, incl. derived columns.
const display = (row: Record<string, any>, key: string): string => {
  if (key === "rep:type") return row.__type ?? "";
  if (key === "assignTimeUtcIso") return row.__assignDisplay ?? "";
  if (key === "dur:assignToAckn") return row.__dur ?? "";
  return String(row[key] ?? "");
};

const row = {
  number: "INC0001001",
  state: "Closed",
  __type: "Incident",
  __assignDisplay: "01-08-2026 10:05:00",
  __dur: "0:30:00"
};

const opt = (over = {}) => ({ column: "", mode: "contains", caseSensitive: false, ...over } as const);

test("empty query matches everything (no filtering)", () => {
  assert.equal(rowMatches(row, "", opt(), display, COLUMNS), true);
  assert.equal(rowMatches(row, "   ", opt({ mode: "notContains" }), display, COLUMNS), true);
});

test("contains, all columns, case-insensitive", () => {
  assert.equal(rowMatches(row, "closed", opt(), display, COLUMNS), true);
  assert.equal(rowMatches(row, "inc0001", opt(), display, COLUMNS), true);
  assert.equal(rowMatches(row, "nomatch", opt(), display, COLUMNS), false);
});

test("case-sensitive respects case", () => {
  assert.equal(rowMatches(row, "closed", opt({ column: "state", caseSensitive: true }), display, COLUMNS), false);
  assert.equal(rowMatches(row, "Closed", opt({ column: "state", caseSensitive: true }), display, COLUMNS), true);
});

test("single-column scope only searches that column", () => {
  assert.equal(rowMatches(row, "INC0001001", opt({ column: "state" }), display, COLUMNS), false);
  assert.equal(rowMatches(row, "Closed", opt({ column: "state" }), display, COLUMNS), true);
});

test("equals is a full-value match, not substring", () => {
  assert.equal(rowMatches(row, "Closed", opt({ column: "state", mode: "equals" }), display, COLUMNS), true);
  assert.equal(rowMatches(row, "Clos", opt({ column: "state", mode: "equals" }), display, COLUMNS), false);
});

test("does not contain keeps rows where the column lacks the query", () => {
  assert.equal(rowMatches(row, "Open", opt({ column: "state", mode: "notContains" }), display, COLUMNS), true);
  assert.equal(rowMatches(row, "Clos", opt({ column: "state", mode: "notContains" }), display, COLUMNS), false);
});

test("does not equal keeps rows whose value is not exactly the query", () => {
  assert.equal(rowMatches(row, "Closed", opt({ column: "state", mode: "notEquals" }), display, COLUMNS), false);
  assert.equal(rowMatches(row, "Clos", opt({ column: "state", mode: "notEquals" }), display, COLUMNS), true);
});

test("all-columns negative mode keeps a row only when NO column matches", () => {
  // "Incident" appears in rep:type, so notContains(all) should drop the row.
  assert.equal(rowMatches(row, "Incident", opt({ mode: "notContains" }), display, COLUMNS), false);
  assert.equal(rowMatches(row, "zzz", opt({ mode: "notContains" }), display, COLUMNS), true);
});

test("matches DISPLAYED value of derived columns (Type, formatted time, duration)", () => {
  assert.equal(rowMatches(row, "Incident", opt({ column: "rep:type", mode: "equals" }), display, COLUMNS), true);
  assert.equal(rowMatches(row, "01-08-2026", opt({ column: "assignTimeUtcIso" }), display, COLUMNS), true);
  assert.equal(rowMatches(row, "0:30:00", opt({ column: "dur:assignToAckn", mode: "equals" }), display, COLUMNS), true);
});

test("selecting a removed column falls back to no filtering", () => {
  assert.equal(rowMatches(row, "anything", opt({ column: "incidentState" }), display, COLUMNS), true);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildWsrFilterSets } from "../core/wsrpreset.ts";
import { weekRanges } from "../core/summarydetails.ts";
import { buildEncodedQuery } from "../core/querybuilder.ts";

// Fixed reference: Thursday 2026-09-03. Last week (Mon-Sun) = 2026-08-24..2026-08-30.
const NOW = new Date(2026, 8, 3, 10, 0, 0);
const LAST = weekRanges(NOW).last;

test("buildWsrFilterSets returns exactly 7 sets in table/state order", () => {
  const sets = buildWsrFilterSets(NOW);
  assert.equal(sets.length, 7);
  assert.deepEqual(
    sets.map((s) => `${s.table}:${(s.conditions[0]).field}=${(s.conditions[0]).value}`),
    [
      "incident:state=7",
      "incident:state=3",
      "incident:state=2",
      "sc_task:state=3",
      "sc_task:state=2",
      "problem:problem_state=103",
      "problem:problem_state=104"
    ]
  );
});

test("problem sets use problem_state; others use state", () => {
  const sets = buildWsrFilterSets(NOW);
  for (const s of sets) {
    const field = (s.conditions[0]).field;
    assert.equal(field, s.table === "problem" ? "problem_state" : "state");
  }
});

test("closed states carry a last-week closed_at between condition; open states carry none", () => {
  const sets = buildWsrFilterSets(NOW);
  const isClosed = (s) => s.table === "incident" && s.conditions[0].value === "7"
    || s.table === "sc_task" && s.conditions[0].value === "3";
  for (const s of sets) {
    if (isClosed(s)) {
      // state + closed_at between + parent_incident isEmpty
      assert.equal(s.conditions.length, 3, `${s.table} closed should have 3 conditions`);
      const d = s.conditions[1];
      assert.equal(d.field, "closed_at");
      assert.equal(d.oper, "between");
      assert.equal(d.value, LAST.from);
      assert.equal(d.value2, LAST.to);
    } else {
      // state + parent_incident isEmpty
      assert.equal(s.conditions.length, 2, `${s.table} ${s.conditions[0].value} should have 2 conditions`);
    }
  }
});

test("every set ends with parent_incident is empty", () => {
  const sets = buildWsrFilterSets(NOW);
  for (const s of sets) {
    const last = s.conditions[s.conditions.length - 1];
    assert.equal(last.field, "parent_incident");
    assert.equal(last.oper, "isEmpty");
  }
});

test("last-week dates are the Monday-Sunday window (2026-08-24..2026-08-30)", () => {
  assert.equal(LAST.from, "2026-08-24");
  assert.equal(LAST.to, "2026-08-30");
});

test("each preset encodes to the correct scoped query", () => {
  const sets = buildWsrFilterSets(NOW);
  const enc = (s) => buildEncodedQuery({ conditions: s.conditions });

  // Closed incident: state + closed_at BETWEEN last week + parent_incident empty.
  assert.equal(
    enc(sets[0]),
    "state=7^closed_atBETWEENjavascript:gs.dateGenerate('2026-08-24','00:00:00')@javascript:gs.dateGenerate('2026-08-30','23:59:59')^parent_incidentISEMPTY"
  );
  // Open incident On Hold / In Progress: state + parent_incident empty.
  assert.equal(enc(sets[1]), "state=3^parent_incidentISEMPTY");
  assert.equal(enc(sets[2]), "state=2^parent_incidentISEMPTY");
  // sc_task closed + open.
  assert.equal(
    enc(sets[3]),
    "state=3^closed_atBETWEENjavascript:gs.dateGenerate('2026-08-24','00:00:00')@javascript:gs.dateGenerate('2026-08-30','23:59:59')^parent_incidentISEMPTY"
  );
  assert.equal(enc(sets[4]), "state=2^parent_incidentISEMPTY");
  // problem uses problem_state, no date.
  assert.equal(enc(sets[5]), "problem_state=103^parent_incidentISEMPTY");
  assert.equal(enc(sets[6]), "problem_state=104^parent_incidentISEMPTY");
});

test("no open-state preset produces a date range", () => {
  const sets = buildWsrFilterSets(NOW);
  for (const s of sets) {
    const q = buildEncodedQuery({ conditions: s.conditions });
    const hasDate = q.includes("gs.dateGenerate");
    // closed sets carry the extra closed_at between condition (3 total).
    const closed = s.conditions.length === 3;
    assert.equal(hasDate, closed);
  }
});

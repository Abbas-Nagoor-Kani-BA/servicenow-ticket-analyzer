import { test } from "node:test";
import assert from "node:assert/strict";

import { buildTicketStats } from "../core/ticketstats.ts";

const fmt = (v) => v;

// A resolved P2 incident whose response/min/max SLAs are all BREACHED
// (same shape as tools/report-test.js -> slaBreach "RM", met* = No/NO/NO).
const breachedResolved = () => ({
  number: "INC0010001", priority: "2 - High", state: "Resolved",
  assignmentGroup: "Q", configItem: "App A",
  createdOn: "2026-08-10 09:00:00",
  assignTimeUtcIso: "2026-08-10T01:00:00.000Z", acknTimeUtcIso: "2026-08-10T02:00:00.000Z",
  resolvedAt: "2026-08-10 15:00:00"
});

// A resolved incident acknowledged fast and resolved fast -> SLAs MET.
const metResolved = () => ({
  number: "INC0010002", priority: "1 - Critical", state: "Closed",
  assignmentGroup: "Q", configItem: "App B",
  createdOn: "2026-08-10 09:00:00",
  assignTimeUtcIso: "2026-08-10T09:00:00.000Z", acknTimeUtcIso: "2026-08-10T09:05:00.000Z",
  resolvedAt: "2026-08-10 09:30:00"
});

const openIncident = (state) => ({
  number: "INC0010003", priority: "2 - High", state,
  assignmentGroup: "Q", configItem: "App C", createdOn: "2026-08-10 09:00:00"
});

test("counts tickets per state, most common first", () => {
  const stats = buildTicketStats([
    openIncident("In Progress"), openIncident("In Progress"),
    openIncident("On Hold"), breachedResolved()
  ], fmt);
  assert.equal(stats.total, 4);
  // All INC -> one "Incident" type group.
  assert.equal(stats.types.length, 1);
  assert.equal(stats.types[0].type, "Incident");
  assert.equal(stats.types[0].count, 4);
  assert.deepEqual(stats.types[0].states.map((s) => `${s.state}:${s.count}`), [
    "In Progress:2", "On Hold:1", "Resolved:1"
  ]);
});

test("groups states under ticket-type headings, types by descending count", () => {
  const stats = buildTicketStats([
    openIncident("In Progress"), openIncident("On Hold"),
    { number: "PRB0001", state: "root cause analysis", createdOn: "2026-08-10 09:00:00" }
  ], fmt);
  assert.deepEqual(stats.types.map((t) => `${t.type}:${t.count}`), [
    "Incident:2", "Problem Record:1"
  ]);
  assert.deepEqual(stats.types[1].states.map((s) => `${s.state}:${s.count}`), [
    "root cause analysis:1"
  ]);
});

test("SLA tallies count only closed/resolved tickets", () => {
  const stats = buildTicketStats([
    openIncident("In Progress"),      // no SLA verdict (open)
    breachedResolved(),               // response/min/max all breached
    metResolved()                     // response breached; min + max met
  ], fmt);
  assert.equal(stats.closedTotal, 2, "two terminal tickets");
  // Verdicts come from buildReport: breachedResolved = No/NO/NO,
  // metResolved = No/YES/YES.
  assert.deepEqual(stats.response, { met: 0, breached: 2 });
  assert.deepEqual(stats.minResolution, { met: 1, breached: 1 });
  assert.deepEqual(stats.maxResolution, { met: 1, breached: 1 });
});

test("open-only view yields no SLA tallies", () => {
  const stats = buildTicketStats([openIncident("New"), openIncident("In Progress")], fmt);
  assert.equal(stats.closedTotal, 0);
  assert.deepEqual(stats.response, { met: 0, breached: 0 });
  assert.deepEqual(stats.minResolution, { met: 0, breached: 0 });
  assert.deepEqual(stats.maxResolution, { met: 0, breached: 0 });
});

test("empty input is safe", () => {
  const stats = buildTicketStats([], fmt);
  assert.equal(stats.total, 0);
  assert.deepEqual(stats.types, []);
  assert.equal(stats.closedTotal, 0);
});

test("missing state falls back to a placeholder label", () => {
  const stats = buildTicketStats([openIncident("")], fmt);
  assert.equal(stats.types[0].states[0].state, "(no state)");
});

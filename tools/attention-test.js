import { test } from "node:test";
import assert from "node:assert/strict";

import { computeAttention, ATTENTION_RULES } from "../core/attention.ts";

const MEMBERS = ["John Doe", "Jane Smith", "Alice Wu"];
const GROUPS = ["APPSUP_TEST", "PAYMENTS"];

function baseRow(overrides = {}) {
  return {
    sysId: "aaa",
    number: "INC0001001",
    state: "Closed",
    priority: "3 - Moderate",
    assignmentGroup: "APPSUP_TEST",
    assignedTo: "",
    rootCause: "Application bug",
    solutionType: "Permanent solution",
    activity: [],
    ...overrides
  };
}

function ids(flags) {
  return flags.map((f) => f.id).sort();
}

test("clean ticket produces no attention flags", () => {
  const flags = computeAttention(baseRow(), { teamMembers: MEMBERS, groupScope: GROUPS });
  assert.deepEqual(flags, []);
});

test("multiple assignments within the team are flagged", () => {
  const row = baseRow({
    activity: [
      { f: "assigned_to", o: "", n: "John Doe", atEpoch: 100 },
      { f: "assigned_to", o: "John Doe", n: "Jane Smith", atEpoch: 200 }
    ]
  });
  const flags = computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS });
  assert.ok(ids(flags).includes("multiAssignWithinTeam"));
  const hit = flags.find((f) => f.id === "multiAssignWithinTeam");
  assert.ok(hit.detail.includes("2 team members"));
});

test("a single team assignment is NOT flagged", () => {
  const row = baseRow({
    activity: [
      { f: "assigned_to", o: "", n: "John Doe", atEpoch: 100 }
    ]
  });
  const flags = computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS });
  assert.ok(!ids(flags).includes("multiAssignWithinTeam"));
});

test("assignments to non-team members do not count", () => {
  const row = baseRow({
    activity: [
      { f: "assigned_to", o: "", n: "Outside Person", atEpoch: 100 },
      { f: "assigned_to", o: "Outside Person", n: "John Doe", atEpoch: 200 }
    ]
  });
  const flags = computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS });
  assert.ok(!ids(flags).includes("multiAssignWithinTeam"));
});

test("multiple queue changes within the selected queues are flagged", () => {
  const row = baseRow({
    activity: [
      { f: "assignment_group", o: "APPSUP_TEST", n: "PAYMENTS", atEpoch: 100 },
      { f: "assignment_group", o: "PAYMENTS", n: "APPSUP_TEST", atEpoch: 200 }
    ]
  });
  const flags = computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS });
  assert.ok(ids(flags).includes("multiGroupWithinTeam"));
});

test("single queue change is not flagged", () => {
  const row = baseRow({
    activity: [
      { f: "assignment_group", o: "OTHER", n: "APPSUP_TEST", atEpoch: 100 }
    ]
  });
  const flags = computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS });
  assert.ok(!ids(flags).includes("multiGroupWithinTeam"));
});

test("reopen (terminal -> active) is flagged regardless of label/raw form", () => {
  const rawRow = baseRow({
    activity: [
      { f: "state", o: "Closed", n: "In Progress", atEpoch: 100 }
    ]
  });
  assert.ok(ids(computeAttention(rawRow, { teamMembers: MEMBERS, groupScope: GROUPS })).includes("reopened"));

  const rawValueRow = baseRow({
    activity: [
      { f: "state", o: "7", n: "2", atEpoch: 100 }
    ]
  });
  assert.ok(ids(computeAttention(rawValueRow, { teamMembers: MEMBERS, groupScope: GROUPS })).includes("reopened"));
});

test("resolved label (Resolved) also counts as a reopen source", () => {
  const row = baseRow({
    activity: [
      { f: "state", o: "Resolved", n: "New", atEpoch: 100 }
    ]
  });
  assert.ok(ids(computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS })).includes("reopened"));
});

test("normal close (active -> terminal) is NOT a reopen", () => {
  const row = baseRow({
    activity: [
      { f: "state", o: "New", n: "Closed", atEpoch: 100 }
    ]
  });
  assert.ok(!ids(computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS })).includes("reopened"));
});

test("SLA breach from the report is flagged", () => {
  const row = baseRow();
  const flags = computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS, report: { slaBreach: "RM" } });
  assert.ok(ids(flags).includes("slaBreach"));
});

test("long single On Hold span is flagged", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  const row = baseRow({
    suspendTimeUtcIso: new Date(start).toISOString(),
    resumeTimeUtcIso: new Date(start + 72 * 3600 * 1000).toISOString()
  });
  const flags = computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS });
  assert.ok(ids(flags).includes("longOnHold"));
  const hit = flags.find((f) => f.id === "longOnHold");
  assert.ok(hit.detail.includes("72 hours"));
});

test("short On Hold span is not flagged", () => {
  const start = Date.UTC(2026, 0, 1, 0, 0, 0);
  const row = baseRow({
    suspendTimeUtcIso: new Date(start).toISOString(),
    resumeTimeUtcIso: new Date(start + 2 * 3600 * 1000).toISOString()
  });
  assert.ok(!ids(computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS })).includes("longOnHold"));
});

test("repeated On Hold (count over threshold) is flagged", () => {
  const row = baseRow({ onHoldCount: 3 });
  const flags = computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS });
  assert.ok(ids(flags).includes("repeatedOnHold"));
});

test("On Hold count within threshold is not flagged", () => {
  const row = baseRow({ onHoldCount: 2 });
  assert.ok(!ids(computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS })).includes("repeatedOnHold"));
});

test("slow pickup: assigned but never acknowledged", () => {
  const row = baseRow({ assignTimeUtcIso: "2026-01-01T00:00:00Z", acknTimeUtcIso: "" });
  const flags = computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS });
  assert.ok(ids(flags).includes("slowPickup"));
});

test("slow pickup: long assign->acknowledge gap", () => {
  const row = baseRow({
    assignTimeUtcIso: "2026-01-01T00:00:00Z",
    acknTimeUtcIso: "2026-01-03T00:00:00Z"
  });
  const flags = computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS });
  assert.ok(ids(flags).includes("slowPickup"));
});

test("quick pickup is not flagged", () => {
  const row = baseRow({
    assignTimeUtcIso: "2026-01-01T00:00:00Z",
    acknTimeUtcIso: "2026-01-01T04:00:00Z"
  });
  assert.ok(!ids(computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS })).includes("slowPickup"));
});

test("empty plan data flags missing root cause + solution type", () => {
  const row = baseRow({ rootCause: "", solutionType: "" });
  const flags = computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS });
  assert.ok(ids(flags).includes("emptyPlan"));
  const hit = flags.find((f) => f.id === "emptyPlan");
  assert.ok(hit.detail.includes("root cause") && hit.detail.includes("solution type"));
});

test("populated plan data is not flagged", () => {
  const row = baseRow({ rootCause: "Application bug", solutionType: "Permanent solution" });
  assert.ok(!ids(computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS })).includes("emptyPlan"));
});

test("low-confidence parse is flagged", () => {
  const row = baseRow({ parseReview: true });
  assert.ok(ids(computeAttention(row, { teamMembers: MEMBERS, groupScope: GROUPS })).includes("lowConfidenceParse"));
});

test("empty / non-object row returns no flags", () => {
  assert.deepEqual(computeAttention(null, { teamMembers: MEMBERS, groupScope: GROUPS }), []);
  assert.deepEqual(computeAttention(undefined, { teamMembers: MEMBERS, groupScope: GROUPS }), []);
  assert.deepEqual(computeAttention("nope", { teamMembers: MEMBERS, groupScope: GROUPS }), []);
});

test("thresholds can be overridden", () => {
  const row = baseRow({ onHoldCount: 3 });
  const flags = computeAttention(row, {
    teamMembers: MEMBERS,
    groupScope: GROUPS,
    thresholds: { maxOnHoldCount: 5 }
  });
  assert.ok(!ids(flags).includes("repeatedOnHold"));
});

test("ATTENTION_RULES lists all nine rules with unique ids", () => {
  assert.equal(ATTENTION_RULES.length, 9);
  const seen = new Set(ATTENTION_RULES.map((r) => r.id));
  assert.equal(seen.size, 9, "rule ids are unique");
  for (const r of ATTENTION_RULES) {
    assert.equal(typeof r.id, "string");
    assert.ok(r.label && typeof r.label === "string", "each rule has a human label");
  }
});

test("ATTENTION_RULES covers every rule id the engine can produce", () => {
  const engineIds = [
    "multiAssignWithinTeam", "multiGroupWithinTeam", "reopened", "slaBreach",
    "longOnHold", "repeatedOnHold", "slowPickup", "emptyPlan", "lowConfidenceParse"
  ].sort();
  const listIds = ATTENTION_RULES.map((r) => r.id).sort();
  assert.deepEqual(listIds, engineIds);
});

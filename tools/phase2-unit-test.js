#!/usr/bin/env node
import { extractTimelines, analyzeAll } from "../core/phase2.ts";

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}
const base = {
  queueName: "QA Queue Alpha",
  memberNames: ["Fred Luddy", "ITIL User"],
  stateMap: { 1: "New", 2: "In Progress", 3: "On Hold", 6: "Resolved", 7: "Closed" },
  snapshotGroupName: "QA Queue Alpha"
};
const ev = (field, oldValue, newValue, at) => ({ field, oldValue, newValue, at });

console.log("== assignTime clamp to opened_at ==");
check("backdated group entry clamps to opened_at",
  extractTimelines([
    ev("assignment_group", "Other Queue", "QA Queue Alpha", "2026-03-11 10:00:00"),
    ev("assigned_to", "", "Fred Luddy", "2026-03-12 09:00:00")
  ], { ...base, openedAtUtcRaw: "2026-03-13 08:00:00" }).assignTimeUtcIso,
  "2026-03-13T08:00:00.000Z");
check("normal entry after birth untouched",
  extractTimelines([
    ev("assignment_group", "Other Queue", "QA Queue Alpha", "2026-03-14 10:00:00")
  ], { ...base, openedAtUtcRaw: "2026-03-13 08:00:00" }).assignTimeUtcIso,
  "2026-03-14T10:00:00.000Z");
check("no openedAt in ctx -> no clamp applied",
  extractTimelines([
    ev("assignment_group", "Other Queue", "QA Queue Alpha", "2020-01-01 00:00:00")
  ], base).assignTimeUtcIso,
  "2020-01-01T00:00:00.000Z");
check("born-in-queue fallback still equals opened_at",
  extractTimelines([], { ...base, openedAtUtcRaw: "2026-03-13 08:00:00" }).assignTimeUtcIso,
  "2026-03-13T08:00:00.000Z");
check("ackn eligibility unaffected by clamp (pre-birth assignment still counts)",
  (() => {
    const t = extractTimelines([
      ev("assignment_group", "Other Queue", "QA Queue Alpha", "2026-03-11 10:00:00"),
      ev("assigned_to", "", "Fred Luddy", "2026-03-12 09:00:00")
    ], { ...base, openedAtUtcRaw: "2026-03-13 08:00:00" });
    return [t.assignTimeUtcIso, t.acknTimeUtcIso];
  })(),
  ["2026-03-13T08:00:00.000Z", "2026-03-12T09:00:00.000Z"]);

console.log("== classic regressions ==");
check("prequeue ackn ignored",
  extractTimelines([
    ev("assigned_to", "", "Fred Luddy", "2026-08-23 06:06:40"),
    ev("assignment_group", "Other Queue", "QA Queue Alpha", "2026-08-23 06:06:43")
  ], { ...base, openedAtUtcRaw: "2026-08-23 06:06:35" }).acknTimeUtcIso,
  null);
check("group re-entry takes latest entry",
  extractTimelines([
    ev("assignment_group", "Other Queue", "QA Queue Alpha", "2026-08-23 06:06:50"),
    ev("assignment_group", "QA Queue Alpha", "Other Queue", "2026-08-23 06:06:55"),
    ev("assignment_group", "Other Queue", "QA Queue Alpha", "2026-08-23 06:07:03"),
    ev("assigned_to", "", "ITIL User", "2026-08-23 06:07:06")
  ], { ...base, openedAtUtcRaw: "2026-08-23 06:06:45" }).assignTimeUtcIso,
  "2026-08-23T06:07:03.000Z");
check("first On Hold wins, double hold counted",
  (() => {
    const t = extractTimelines([
      ev("assignment_group", "Other Queue", "QA Queue Alpha", "2026-08-23 06:08:00"),
      ev("state", "2", "3", "2026-08-23 06:08:10"),
      ev("state", "3", "2", "2026-08-23 06:08:20"),
      ev("state", "2", "3", "2026-08-23 06:08:30"),
      ev("state", "3", "2", "2026-08-23 06:08:40")
    ], { ...base, openedAtUtcRaw: "2026-08-23 06:08:00" });
    return [t.suspendTimeUtcIso, t.onHoldCount];
  })(),
  ["2026-08-23T06:08:10.000Z", 2]);
check("hold->resolve gives resumeSource Resolved",
  (() => {
    const t = extractTimelines([
      ev("assignment_group", "Other Queue", "QA Queue Alpha", "2026-08-23 06:09:00"),
      ev("state", "2", "3", "2026-08-23 06:09:05"),
      ev("state", "3", "6", "2026-08-23 06:09:10")
    ], { ...base, openedAtUtcRaw: "2026-08-23 06:09:00" });
    return [t.resumeTimeUtcIso, t.resumeSource];
  })(),
  ["2026-08-23T06:09:10.000Z", "Resolved"]);
check("latest In Progress wins (not first)",
  (() => {
    const t = extractTimelines([
      ev("assignment_group", "Other Queue", "QA Queue Alpha", "2026-08-23 06:10:00"),
      ev("state", "2", "3", "2026-08-23 06:10:05"),
      ev("state", "3", "2", "2026-08-23 06:10:10"),
      ev("state", "2", "3", "2026-08-23 06:10:20"),
      ev("state", "3", "2", "2026-08-23 06:10:25")
    ], { ...base, openedAtUtcRaw: "2026-08-23 06:10:00" });
    return [t.suspendTimeUtcIso, t.resumeTimeUtcIso, t.onHoldCount];
  })(),
  ["2026-08-23T06:10:05.000Z", "2026-08-23T06:10:25.000Z", 2]);
check("resume from any state (not only from On Hold)",
  (() => {
    const t = extractTimelines([
      ev("assignment_group", "Other Queue", "QA Queue Alpha", "2026-08-23 06:11:00"),
      ev("state", "2", "3", "2026-08-23 06:11:05"),
      ev("state", "3", "6", "2026-08-23 06:11:10"),
      ev("state", "6", "2", "2026-08-23 06:11:15")
    ], { ...base, openedAtUtcRaw: "2026-08-23 06:11:00" });
    return [t.resumeTimeUtcIso, t.resumeSource];
  })(),
  ["2026-08-23T06:11:15.000Z", "In Progress"]);
check("suspend only while in queue (hold during OTHER ignored)",
  extractTimelines([
    ev("assignment_group", "Other Queue", "QA Queue Alpha", "2026-08-23 06:07:30"),
    ev("assignment_group", "QA Queue Alpha", "Other Queue", "2026-08-23 06:07:32"),
    ev("state", "2", "3", "2026-08-23 06:07:33"),
    ev("state", "3", "2", "2026-08-23 06:07:34"),
    ev("assignment_group", "Other Queue", "QA Queue Alpha", "2026-08-23 06:07:35")
  ], { ...base, openedAtUtcRaw: "2026-08-23 06:07:20" }).suspendTimeUtcIso,
  null);
check("never held -> resume stays null",
  extractTimelines([
    ev("assignment_group", "Other Queue", "QA Queue Alpha", "2026-08-23 06:06:20"),
    ev("state", "1", "6", "2026-08-23 06:06:25")
  ], { ...base, openedAtUtcRaw: "2026-08-23 06:06:20" }).resumeTimeUtcIso,
  null);

console.log("== feed display-label state events (real list_history payload) ==");
check("full lifecycle with label values: ackn+hold+resume",
  (() => {
    const t = extractTimelines([
      ev("state", "", "New", "2026-08-23 06:07:38"),
      ev("assigned_to", "", "ITIL User", "2026-08-23 06:07:44"),
      ev("state", "New", "In Progress", "2026-08-23 06:07:44"),
      ev("state", "In Progress", "On Hold", "2026-08-23 06:07:46"),
      ev("state", "On Hold", "In Progress", "2026-08-23 06:07:50"),
      ev("state", "In Progress", "Resolved", "2026-08-23 06:07:53"),
      ev("state", "Resolved", "Closed", "2026-08-23 06:07:55")
    ], { ...base, snapshotGroupName: "QA Queue Alpha", openedAtUtcRaw: "2026-08-23 06:07:38" });
    return [t.assignTimeUtcIso, t.acknTimeUtcIso, t.suspendTimeUtcIso, t.resumeTimeUtcIso, t.resumeSource];
  })(),
  ["2026-08-23T06:07:38.000Z", "2026-08-23T06:07:44.000Z", "2026-08-23T06:07:46.000Z", "2026-08-23T06:07:53.000Z", "Resolved"]);
check("label hold->resolved fallback still works",
  (() => {
    const t = extractTimelines([
      ev("assignment_group", "Other Queue", "QA Queue Alpha", "2026-08-23 06:09:00"),
      ev("state", "2", "3", "2026-08-23 06:09:05"),
      ev("state", "On Hold", "Resolved", "2026-08-23 06:09:10")
    ], { ...base, openedAtUtcRaw: "2026-08-23 06:09:00" });
    return [t.suspendTimeUtcIso, t.resumeTimeUtcIso, t.resumeSource];
  })(),
  ["2026-08-23T06:09:05.000Z", "2026-08-23T06:09:10.000Z", "Resolved"]);

console.log("== analyzeAll: suspend/resume only for closed/resolved incidents ==");
(() => {
  const stateMap = { 1: "New", 2: "In Progress", 3: "On Hold", 6: "Resolved", 7: "Closed" };
  const auditRows = [
    { field: "assignment_group", oldValue: "Other", newValue: "QA Queue Alpha", at: "2026-08-23 06:01:00" },
    { field: "state", oldValue: "2", newValue: "3", at: "2026-08-23 06:02:00" },
    { field: "state", oldValue: "3", newValue: "2", at: "2026-08-23 06:03:00" },
    { field: "state", oldValue: "2", newValue: "7", at: "2026-08-23 06:04:00" }
  ];
  const queueCtx = {
    membersByQueue: { "qa queue alpha": ["Fred Luddy"] },
    fallbackMembers: [],
    tableName: "incident"
  };
  const makeRec = (sysId, number, state) => ({ sys_id: sysId, number, state, assignment_group: "QA Queue Alpha", opened_at: "2026-08-23 06:00:00" });
  const incidentAudit = { s1: auditRows, s2: auditRows, s3: auditRows };

  const incidentRecs = [
    makeRec("s1", "INC001", "Closed"),
    makeRec("s2", "INC002", "In Progress"),
    makeRec("s3", "INC003", "Resolved")
  ];
  const res1 = analyzeAll(incidentRecs, incidentAudit, stateMap, queueCtx);
  const closed = res1.rows.find(r => r.number === "INC001");
  const open = res1.rows.find(r => r.number === "INC002");
  const resolved = res1.rows.find(r => r.number === "INC003");
  check("closed incident has suspendTime", !!closed.suspendTimeUtcIso, true);
  check("closed incident has resumeTime", !!closed.resumeTimeUtcIso, true);
  check("resolved incident has suspendTime", !!resolved.suspendTimeUtcIso, true);
  check("resolved incident has resumeTime", !!resolved.resumeTimeUtcIso, true);
  check("open incident has no suspendTime", open.suspendTimeUtcIso, "");
  check("open incident has no resumeTime", open.resumeTimeUtcIso, "");

  const problemRecs = [makeRec("s4", "PRB001", "Closed")];
  const res2 = analyzeAll(problemRecs, { s4: auditRows }, stateMap, { ...queueCtx, tableName: "problem" });
  const problem = res2.rows.find(r => r.number === "PRB001");
  check("closed problem has no suspendTime", problem.suspendTimeUtcIso, "");
  check("closed problem has no resumeTime", problem.resumeTimeUtcIso, "");
})();

console.log("== analyzeAll: request_item.number maps to row.requestItem ==");
(() => {
  const stateMap = { 1: "Open", 2: "In progress", 3: "Closed Complete" };
  const queueCtx = { membersByQueue: {}, fallbackMembers: [], tableName: "sc_task" };
  const recs = [
    { sys_id: "t1", number: "SCTASK0001", state: "In progress", opened_at: "2026-08-23 06:00:00",
      "request_item.number": { display_value: "RITM0012345", value: "RITM0012345" } },
    { sys_id: "t2", number: "SCTASK0002", state: "In progress", opened_at: "2026-08-23 06:00:00" }
  ];
  const res = analyzeAll(recs, {}, stateMap, queueCtx);
  const withRitm = res.rows.find(r => r.number === "SCTASK0001");
  const noRitm = res.rows.find(r => r.number === "SCTASK0002");
  check("sc_task maps request_item.number to requestItem", withRitm.requestItem, "RITM0012345");
  check("sc_task with no request_item has empty requestItem", noRitm.requestItem, "");
})();

console.log(`\nphase2: ${failed ? failed + " FAILED" : "all passed"}`);
process.exit(failed ? 1 : 0);

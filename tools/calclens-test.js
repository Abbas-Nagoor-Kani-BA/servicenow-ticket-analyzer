#!/usr/bin/env node
import { explainCell } from "../core/calclens.ts";

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}
function has(name, arr, re) {
  const list = Array.isArray(arr) ? arr : [arr];
  const ok = list.some((s) => re.test(String(s)));
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}`);
}
function hasArr(name, arr, re) {
  const ok = Array.isArray(arr) && arr.some((o) => re.test(String(o.label ?? o.value)));
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}`);
}

const at = (iso) => Date.parse(iso);

const baseRow = {
  sysId: "S1",
  number: "INC0010001",
  priority: "2",
  state: "Resolved",
  assignmentGroup: "Service Desk",
  assignedTo: "Jasmine Lee",
  createdOn: "01-07-2026 09:00:00",
  openedAt: "01-07-2026 09:00:00",
  openedAtRaw: "2026-01-07 09:00:00",
  resolvedAt: "01-07-2026 12:00:00",
  resolvedAtRaw: "2026-01-07 12:00:00",
  assignTimeUtcIso: "2026-01-07T09:15:00.000Z",
  acknTimeUtcIso: "2026-01-07T09:35:00.000Z",
  suspendTimeUtcIso: "2026-01-07T10:00:00.000Z",
  resumeTimeUtcIso: "2026-01-07T11:30:00.000Z",
  resumeSource: "In Progress",
  onHoldCount: 1,
  activity: [
    { f: "state", o: "1", n: "1", atEpoch: at("2026-01-07T09:00:00.000Z") },
    { f: "assignment_group", o: "Service Desk", n: "Service Desk", atEpoch: at("2026-01-07T09:15:00.000Z") },
    { f: "assigned_to", o: "", n: "Jasmine Lee", atEpoch: at("2026-01-07T09:35:00.000Z") },
    { f: "state", o: "2", n: "3", atEpoch: at("2026-01-07T10:00:00.000Z") },
    { f: "state", o: "3", n: "2", atEpoch: at("2026-01-07T11:30:00.000Z") },
    { f: "state", o: "7", n: "7", atEpoch: at("2026-01-07T12:00:00.000Z") }
  ]
};
baseRow.closeNotes = "Root cause: Payment Gateway Timeout after network issue";

const fmt = (iso) => {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
};

console.log("== raw column ==");
const rRaw = explainCell(baseRow, "priority", { fmtInstant: fmt });
check("kind", rRaw.kind, "raw");
has("priority raw", rRaw.steps, /copied|not computed/);

console.log("== static column: timeline + markers + counts + digests ==");
check("raw timeline present", Array.isArray(rRaw.timeline) && rRaw.timeline.length > 0, true);
check("raw timeline chronological", rRaw.timeline.every((e, i, a) => i === 0 || a[i - 1].atIso <= e.atIso), true);
const markLabels = rRaw.timeline.flatMap((e) => (e.markers || []).map((m) => m.label)).sort();
check("raw six key-moment markers", markLabels, ["Ackn", "Assign", "Opened", "Resolved", "Resume", "Suspend"].sort());
const assignMark = rRaw.timeline.find((e) => (e.markers || []).some((m) => m.label === "Assign"));
check("assign marker shows display time", assignMark && assignMark.markers.find((m) => m.label === "Assign").time, "07-01-2026 09:15:00");
check("raw change counts", rRaw.counts, { assignments: 1, states: 4, groups: 1 });
check("raw SLA digests present", Array.isArray(rRaw.digests) && rRaw.digests.length === 2, true);
check("raw response digest verdict", typeof rRaw.digests[0].met, "boolean");
check("raw resolution digest verdict", typeof rRaw.digests[1].met, "boolean");


console.log("== timeline: assign ==");
const rAssign = explainCell(baseRow, "assignTimeUtcIso", { fmtInstant: fmt });
check("kind timeline", rAssign.kind, "timeline");
check("transition shown", rAssign.transition, "Service Desk → Service Desk");
has("assign step queue name", rAssign.steps, /Service Desk/);
has("assign step concrete times", rAssign.steps, /09:15:00|opened/);
has("assign step clamp/opened", rAssign.steps, /opened time|opened/);

console.log("== timeline: born-in-queue fallback ==");
const fallbackRow = {
  ...baseRow,
  activity: [],
  assignmentGroup: "Service Desk",
  assignTimeUtcIso: "2026-01-07T09:00:00.000Z"
};
const rBFall = explainCell(fallbackRow, "assignTimeUtcIso", { fmtInstant: fmt });
has("born-in-queue warning", rBFall.warnings, /started in this queue/i);
check("no transition when no event", rBFall.transition, undefined);

console.log("== timeline: ackn ==");
const rAckn = explainCell(baseRow, "acknTimeUtcIso", { fmtInstant: fmt });
check("transition shown", rAckn.transition, "— → Jasmine Lee");
has("ackn step person name", rAckn.steps, /Jasmine Lee/);
has("ackn step team list", rAckn.steps, /Service Desk/);

console.log("== timeline: suspend ==");
const rSuspend = explainCell(baseRow, "suspendTimeUtcIso", { fmtInstant: fmt });
check("transition shown (state labels)", rSuspend.transition, "In Progress → On Hold");
has("suspend step onto hold", rSuspend.steps, /INTO "On Hold"|ON Hold/i);

console.log("== timeline: resume ==");
const rResume = explainCell(baseRow, "resumeTimeUtcIso", { fmtInstant: fmt });
check("transition shown", rResume.transition, "On Hold → In Progress");
has("resume source", rResume.steps, /In Progress/);

console.log("== durations ==");
const rDur = explainCell(baseRow, "dur:assignToAckn", {});
check("kind duration", rDur.kind, "duration");
has("duration summary plain", rDur.summary, /picked up|reached this team/);
has("duration queue", rDur.steps, /Service Desk/);
has("duration person", rDur.steps, /Jasmine Lee/);
has("duration decimal+clock", rDur.steps, /0:20:00|0\.33/);
has("duration business note", rDur.steps, /straight|excludes|business/);

const rDurRes = explainCell(baseRow, "dur:assignToResolve", {});
has("resolve interval", rDurRes.summary, /time from assignment to resolution|resolved/);

const rDurSus = explainCell(baseRow, "dur:suspendTotal", {});
check("kind duration", rDurSus.kind, "duration");
has("suspend first-window step", rDurSus.steps, /first On Hold|first resume|undercount/);

console.log("== report ==");
const rRep = explainCell(baseRow, "rep:responseSLA", { fmtInstant: fmt });
check("kind report", rRep.kind, "report");
has("report step queue", rRep.steps, /Service Desk/);
has("report step person", rRep.steps, /Jasmine Lee/);
has("report step decimal+clock", rRep.steps, /0\.3 h|0:20:00/);

const rRepMet = explainCell(baseRow, "rep:metResponseSLA", { fmtInstant: fmt });
check("kind report", rRepMet.kind, "report");

console.log("== timeline strip (highlight) ==");
check("assign timeline present", Array.isArray(rAssign.timeline) && rAssign.timeline.length > 0, true);
const selAssign = rAssign.timeline.filter((e) => e.selected);
check("one selected on assign", selAssign.length, 1);
check("selected is assignment_group event", selAssign[0] && selAssign[0].fieldIcon, "group");
check("timeline chronological", rAssign.timeline.every((e, i, a) => i === 0 || a[i - 1].atIso <= e.atIso), true);
const selSuspend = rSuspend.timeline.filter((e) => e.selected);
check("suspend selected is state event", selSuspend[0] && selSuspend[0].fieldIcon, "state");
const rBFc = explainCell(fallbackRow, "assignTimeUtcIso", { fmtInstant: fmt });
check("born-in-queue: timeline present", Array.isArray(rBFc.timeline), true);
check("born-in-queue: no selected event", rBFc.timeline.some((e) => e.selected), false);

console.log("== SLA digest ==");
check("response digest present", !!rRep.digest, true);
has("response target contains hours", rRep.digest.target, /h/);
check("response met is boolean", typeof rRep.digest.met, "boolean");
check("response metLabel matches met", rRep.digest.metLabel, rRep.digest.met ? "Met" : "Breached");
check("response sourceTimes present", Array.isArray(rRep.digest.sourceTimes) && rRep.digest.sourceTimes.length === 2, true);
check("response Assigned source time", rRep.digest.sourceTimes[0].label, "Assigned");
check("response Ack source time", rRep.digest.sourceTimes[1].label, "Ack");
check("response Assigned value non-empty", rRep.digest.sourceTimes[0].value !== "" && rRep.digest.sourceTimes[0].value !== "—", true);
check("response op matches priority-2 branch", rRep.digest.op, "Ack \u2212 Assigned (straight elapsed)");
const rResD = explainCell(baseRow, "rep:incCurrentHours", { fmtInstant: fmt });
check("resolution digest present", !!rResD.digest, true);
has("resolution target range", rResD.digest.target, /–/);
check("resolution met is boolean", typeof rResD.digest.met, "boolean");
check("resolution sourceTimes present", Array.isArray(rResD.digest.sourceTimes) && rResD.digest.sourceTimes.length === 2, true);
check("resolution Assigned source time", rResD.digest.sourceTimes[0].label, "Assigned");
check("resolution Resolved source time", rResD.digest.sourceTimes[1].label, "Resolved");
check("resolution op matches priority-2 branch", rResD.digest.op, "Resolved \u2212 Assigned (straight elapsed)");

console.log("== classification by source ==");
const rcHeur = explainCell({ ...baseRow, rootCause: "Payment Gateway Timeout", __rcSource: "heuristic", __rcConf: 0.62 }, "rootCause", {});
check("heur kind", rcHeur.kind, "classification");
check("heur source input", rcHeur.inputs.find(i=>i.label==="Source").value, "HEURISTIC");
has("heur step two-way", rcHeur.steps, /two ways: by the machine-learning model and by keyword matching/);
has("heur step best label", rcHeur.steps, /Payment Gateway Timeout/);
check("heur confidence string", typeof rcHeur.confidence, "string");

const rcMl = explainCell({ ...baseRow, rootCause: "Hardware", __rcSource: "ml", __rcConf: 0.87, __modelId: "mobilebert" }, "rootCause", {});
check("ml kind", rcMl.kind, "classification");
check("ml source input", rcMl.inputs.find(i=>i.label==="Source").value, "ML");
check("ml confidence", rcMl.confidence, "87%");
has("ml step go-with-model", rcMl.steps, /go with the model's pick/);
has("ml step shows ml label", rcMl.steps, /Hardware/);
check("ml no 55% floor claim", rcMl.steps.some((s) => /55%|≥ 55/.test(s)), false);

const rcManual = explainCell({ ...baseRow, rootCause: "Network", __rcSource: "" }, "rootCause", {});
check("manual kind", rcManual.kind, "classification");
has("manual step", rcManual.steps, /already on the row/);
check("manual no confidence", rcManual.confidence, undefined);

const rSol = explainCell(baseRow, "solutionType", {});
check("solutionType kind", rSol.kind, "classification");

console.log("== MSR picklist choices ==");
const msrLists = { subCategory: ["Login", "Performance", "Network", "Storage"], duplicate: ["Yes", "No"] };
const rSub = explainCell({ ...baseRow, subCategory: "Network" }, "subCategory", { msrLists });
check("subCategory kind", rSub.kind, "raw");
has("subCategory exact member", rSub.steps, /exact member/);
check("subCategory options count", rSub.inputs.find(i=>i.label==="Sub-category options").value, "4");
const rDup = explainCell({ ...baseRow, duplicateIncident: "No" }, "duplicateIncident", { msrLists });
check("duplicate kind", rDup.kind, "raw");
has("duplicate exact member", rDup.steps, /exact member/);

console.log("== incident-hour / age splits ==");
const rInc = explainCell(baseRow, "rep:incidentHours", { fmtInstant: fmt });
check("incidentHours kind", rInc.kind, "report");
has("incidentHours Created->Resolved", rInc.steps, /created|Created/);
const rIncAge = explainCell(baseRow, "rep:incidentTotalAge", { fmtInstant: fmt });
has("totalAge 9 work-hours per day", rIncAge.steps, /9 working hours per day|work-hours/);
const rCur = explainCell(baseRow, "rep:incCurrentHours", { fmtInstant: fmt });
has("current Assigned start", rCur.steps, /assigned|Assigned/);
const rCurAge = explainCell(baseRow, "rep:incidentCurrentAge", { fmtInstant: fmt });
has("currentAge 9 work-hours per day", rCurAge.steps, /9 working hours per day|work-hours/);
const rCum = explainCell({ ...baseRow }, "rep:cumulativeSla", { fmtInstant: fmt });
check("cumulative digest present", !!rCum.digest, true);
check("cumulative metLabel set", ["Met", "Breached", "unknown"].includes(rCum.digest.metLabel), true);
hasArr("cumulative digest pairs SLA/day", rCum.digest.sourceTimes, /Cumulative/);

console.log("== unknown / null row ==");
check("null for unknown column", explainCell(baseRow, "not-a-column", {}), null);
check("null for non-object row", explainCell(null, "priority", {}), null);

process.exit(failed ? 1 : 0);

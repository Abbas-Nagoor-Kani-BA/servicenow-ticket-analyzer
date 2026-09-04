#!/usr/bin/env node
import * as R from "../core/report.ts";

let failed = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}

console.log("== deriveType ==");
check("INC", R.deriveType("INC0010001"), "Incident");
check("REQ", R.deriveType("REQ0010001"), "RFS");
check("SCTASK", R.deriveType("SCTASK0010001"), "RFS");
check("PRB", R.deriveType("PRB0010001"), "Problem Record");
check("PTASK (legacy)", R.deriveType("PTASK0010001"), "Problem Record");
check("empty", R.deriveType(""), "");
check("unknown", R.deriveType("CHG0030001"), "");

console.log("== normDisplay ==");
check("iso to day-first", R.normDisplay("2026-08-10 05:36:40"), "10-08-2026 05:36:40");
check("T separator", R.normDisplay("2026-08-10T05:36"), "10-08-2026 05:36");
check("already day-first", R.normDisplay("10-08-2026 05:36:40"), "10-08-2026 05:36:40");

console.log("== SLA priority ==");
check("P1", R.slaPriority("1 - Critical"), 1);
check("P4", R.slaPriority("4 - Low"), 4);
check("P5 clamps to 4", R.slaPriority("5 - Planning"), 4);
check("garbage", R.slaPriority(""), 0);

console.log("== business hours ==");
check("same day inside hours", R.businessHoursBetween("10-08-2026 09:00:00", "10-08-2026 12:00:00"), 3);
check("over working days", R.businessHoursBetween("14-08-2026 16:00:00", "17-08-2026 10:00:00"), 3);
check("P1 elapsed ignores biz hours",
  R.calcBusinessHours("10-08-2026 09:00:00", "10-08-2026 13:00:00", "", "", "1 - Critical"), "4.00");
check("P3 biz hours minus suspension",
  R.calcBusinessHours("10-08-2026 08:00:00", "11-08-2026 17:00:00", "10-08-2026 12:00:00", "10-08-2026 14:00:00", "3 - Moderate"), "16.00");
check("suspended not resumed stops clock at suspend (P3)",
  R.calcIncCurrentHours("10-08-2026 09:00:00", "", "10-08-2026 12:00:00", "", "3 - Moderate"), "3.00");

console.log("== response SLA ==");
check("P1 simple hms", R.calcResponseSLA("10-08-2026 09:00:00", "10-08-2026 10:30:00", "", "", "1"), "1:30:00");
check("no ackn -> empty", R.calcResponseSLA("", "10-08-2026 10:30:00", "", "", "1"), "");

console.log("== instance-zone business hours (TZ-invariant, issue 003) ==");
// The input strings are instance-local wall-clock. The math must be independent of
// the browser's timezone (run report-test under any TZ value -> identical results),
// which the old `new Date("...")` + getHours() code did NOT guarantee.
check("same-day 09->12", R.businessHoursBetween("10-08-2026 09:00:00", "10-08-2026 12:00:00"), 3);
check("cross-weekend Fri16->Mon10", R.businessHoursBetween("14-08-2026 16:00:00", "17-08-2026 10:00:00"), 3);
check("cross-day Tue09->Wed10 (P3)", R.calcBusinessHours("25-08-2026 09:00:00", "26-08-2026 10:00:00", "", "", "3 - Moderate"), "10.00");
check("P3 sub-day after-hours-only start is 0", R.businessHoursBetween("25-08-2026 18:00:00", "25-08-2026 19:00:00"), 0);

console.log("== met flags (strict <) ==");
check("met max: 3 < P2.max(8)", R.metSLA(3, "2 - High", "max"), "YES");
check("at threshold: 8 < P2.max(8) is false", R.metSLA(8, "2 - High", "max"), "NO");
check("miss min: 5 < P2.min(2) is false", R.metSLA(5, "2 - High", "min"), "NO");
check("met min: 1 < P2.min(2)", R.metSLA(1, "2 - High", "min"), "YES");
check("hms to hours", R.hmsToHours("1:30:00"), 1.5);

console.log("== buildReport ==");
const row = {
  number: "INC0010001", priority: "2 - High", state: "Resolved",
  assignmentGroup: "QA Queue Alpha", configItem: "App A",
  createdOn: "2026-08-10 09:00:00",
  assignTimeUtcIso: "2026-08-10T01:00:00.000Z", acknTimeUtcIso: "2026-08-10T02:00:00.000Z",
  resolvedAt: "2026-08-10 15:00:00", solutionType: "Permanent fix", rootCause: "Bad config"
};
const fmt = v => v;
const rep = R.buildReport(row, fmt);
check("type", rep.type, "Incident");
check("opCo", rep.opCo, "BA");
check("created normalized", rep.created, "10-08-2026 09:00:00");
check("assigned normalized", rep.assigned, "10-08-2026 01:00:00");
check("incident hours P2 elapsed", rep.incidentHours, "6:00:00");
check("total age /9", rep.incidentTotalAge, "0.67");
check("response sla (1h elapsed)", rep.responseSLA, "1:00:00");
check("met response: 1h < 0.25h P2 resp is false", rep.metResponseSLA, "No");
check("met min: incCurrentHours(14h) < P2.min(2) is false", rep.metMinResolutionSLA, "NO");
check("met max: incCurrentHours(14h) < P2.max(8) is false", rep.metMaxResolutionSLA, "NO");
check("slaBreach: No + NO -> RM", rep.slaBreach, "RM");
check("analysed date shape", /^\d{2}\/\d{2}\/\d{4}$/.test(rep.analysedDate), true);

console.log("== slaBreach scenarios ==");
(() => {
  const make = (num, pri, acknTimeUtcIso, resH) => ({
    number: num, priority: pri, state: "Resolved",
    assignmentGroup: "Q", configItem: "",
    createdOn: "2026-08-10 08:00:00",
    assignTimeUtcIso: "2026-08-10T00:00:00.000Z",
    acknTimeUtcIso: acknTimeUtcIso || "",
    resolvedAt: resH ? `2026-08-10 ${String(resH).padStart(2,"0")}:00:00` : ""
  });
  check("both breached: resp=1h>0.25h + max=9h>8h -> RM",
    R.buildReport(make("INC1","2 - High", "2026-08-10T01:00:00.000Z", 9), fmt).slaBreach, "RM");
  check("response only: resp=1h>0.25h + max=7h<8h -> R",
    R.buildReport(make("INC2","2 - High", "2026-08-10T01:00:00.000Z", 7), fmt).slaBreach, "R");
  check("max only: resp=5m<0.25h + max=9h>8h -> M",
    R.buildReport(make("INC3","2 - High", "2026-08-10T00:05:00.000Z", 9), fmt).slaBreach, "M");
  check("none breached: resp=5m<0.25h + max=7h<8h -> empty",
    R.buildReport(make("INC4","2 - High", "2026-08-10T00:05:00.000Z", 7), fmt).slaBreach, "");
})();

console.log("== resolved display string not re-parsed (regression) ==");
(() => {
  // fmt mimics the viewer's fmtInstant: it treats input as an epoch, applies the
  // instance offset and reformats. Feeding it a day-first display-value string
  // must NOT shift/swap the date. This regression covers INC2536430 in
  // tools/sample.json, whose 12-08-2026 16:06:33 displayed as 08-12-2026 21:36:33
  // and inflated the total age to 84.45 days.
  const off = 19800000; // +5:30
  const fmtParse = v => {
    if (!v) return "";
    const d = new Date(v);
    if (isNaN(d)) return String(v);
    const s = new Date(d.getTime() + off);
    const p = n => String(n).padStart(2, "0");
    return `${s.getUTCFullYear()}-${p(s.getUTCMonth() + 1)}-${p(s.getUTCDate())} ` +
      `${p(s.getUTCHours())}:${p(s.getUTCMinutes())}:${p(s.getUTCSeconds())}`;
  };
  const row = {
    number: "INC2536430", priority: "4 - Low", state: "Closed",
    assignmentGroup: "Q", configItem: "",
    createdOn: "11-08-2026 19:40:58",
    resolvedAt: "12-08-2026 16:06:33",
    assignTimeUtcIso: "2026-08-11T14:10:58.000Z",
    acknTimeUtcIso: "2026-08-12T04:34:54.000Z",
    suspendTimeUtcIso: "2026-08-12T05:41:40.000Z",
    resumeTimeUtcIso: "2026-08-12T10:36:33.000Z",
    solutionType: "", rootCause: ""
  };
  const rep = R.buildReport(row, fmtParse);
  check("resolved display day-first unchanged", rep.resolved, "12-08-2026 16:06:33");
  check("created display day-first unchanged", rep.created, "11-08-2026 19:40:58");
  check("incident total age is business days (not ~85)", Number(rep.incidentTotalAge) < 2, true);
})();

console.log("== SLA eligibility gate (INC + closed/resolved only) ==");
(() => {
  const base = {
    number: "INC0010001", priority: "2 - High", state: "Resolved",
    assignmentGroup: "Q", configItem: "App A",
    createdOn: "2026-08-10 09:00:00",
    assignTimeUtcIso: "2026-08-10T01:00:00.000Z", acknTimeUtcIso: "2026-08-10T02:00:00.000Z",
    resolvedAt: "2026-08-10 15:00:00", solutionType: "Permanent fix", rootCause: "Bad config"
  };
  const gatedBlank = (rep) =>
    rep.incidentHours === "" && rep.incidentTotalAge === "" && rep.incCurrentHours === "" &&
    rep.incidentCurrentAge === "" && rep.responseSLA === "" && rep.metResponseSLA === "" &&
    rep.metMinResolutionSLA === "" && rep.metMaxResolutionSLA === "" && rep.slaBreach === "" &&
    rep.cumulativeSla === "" && rep.cumulativeDays === "" && rep.timeTaken === "" &&
    rep.respHours === undefined && rep.incHoursRaw === undefined && rep.incCurrentRaw === undefined;

  check("isSlaEligible: INC + Resolved", R.isSlaEligible({ number: "INC1", state: "Resolved" }), true);
  check("isSlaEligible: INC + Closed", R.isSlaEligible({ number: "INC1", state: "Closed Complete" }), true);
  check("isSlaEligible: INC + In Progress -> false", R.isSlaEligible({ number: "INC1", state: "In Progress" }), false);
  check("isSlaEligible: PRB + Resolved -> false", R.isSlaEligible({ number: "PRB1", state: "Resolved" }), false);
  check("isSlaEligible: SCTASK + Closed -> false", R.isSlaEligible({ number: "SCTASK1", state: "Closed" }), false);

  // Eligible incident keeps its computed SLA values.
  const okRep = R.buildReport({ ...base }, fmt);
  check("eligible INC keeps incidentHours", okRep.incidentHours, "6:00:00");
  check("eligible INC keeps a breach code", okRep.slaBreach, "RM");

  // Open incident: SLA fields blanked, passthrough kept.
  const openRep = R.buildReport({ ...base, state: "In Progress" }, fmt);
  check("open INC blanks all SLA fields", gatedBlank(openRep), true);
  check("open INC keeps type", openRep.type, "Incident");
  check("open INC keeps created passthrough", openRep.created, "10-08-2026 09:00:00");
  check("open INC keeps rootCauseCategory passthrough", openRep.rootCauseCategory, "Bad config");

  // Non-incident (Problem), even when resolved: blanked.
  const prbRep = R.buildReport({ ...base, number: "PRB0010001" }, fmt);
  check("resolved PRB blanks all SLA fields", gatedBlank(prbRep), true);
  check("resolved PRB keeps type Problem Record", prbRep.type, "Problem Record");
})();

console.log("== report cache invalidation on edited derivation columns ==");
(() => {
  const id = v => v || "";
  const mk = () => ({
    number: "INC0010001", priority: "2 - High", state: "Resolved",
    createdOn: "2026-08-10 09:00:00", resolvedAt: "2026-08-10 15:00:00",
    assignTimeUtcIso: "2026-08-10T01:00:00.000Z", acknTimeUtcIso: "2026-08-10T02:00:00.000Z",
    suspendTimeUtcIso: "", resumeTimeUtcIso: "",
    rootCause: "Bad config", solutionType: "Permanent fix"
  });

  // Choice columns (the bug: these were absent from the cache key).
  const rc = mk(); R.buildReport(rc, id); rc.rootCause = "EDITED RC";
  check("edited root cause invalidates cache", R.buildReport(rc, id).rootCauseCategory, "EDITED RC");
  const st = mk(); R.buildReport(st, id); st.solutionType = "EDITED ST";
  check("edited resolution type invalidates cache", R.buildReport(st, id).resolutionType, "EDITED ST");

  // Every editable derived-time column must also invalidate the cache. These
  // were already keyed; the assertions guard against a future regression that
  // adds an editable column without extending the cache key.
  const timeCols = [
    ["assignTimeUtcIso", "assigned"],
    ["acknTimeUtcIso", "ackn"],
    ["suspendTimeUtcIso", "susp"],
    ["resumeTimeUtcIso", "resumed"]
  ];
  for (const [field, out] of timeCols) {
    const row = mk();
    const before = R.buildReport(row, id)[out];
    row[field] = "2026-08-10T04:30:00.000Z";
    const after = R.buildReport(row, id)[out];
    check(`edited ${field} invalidates cache`, after !== before, true);
  }
})();

console.log(`\nreport: ${failed ? failed + " FAILED" : "all passed"}`);
process.exit(failed ? 1 : 0);

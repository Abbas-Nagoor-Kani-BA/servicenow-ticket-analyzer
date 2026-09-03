#!/usr/bin/env node
import {
  weekRanges,
  bucketChanges,
  keyIncidents,
  buildSummaryDetails
} from "../core/summarydetails.ts";

let failed = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}

// Reference "now" = Thursday 2026-09-03 (local). Weeks are Monday-Sunday:
//   last week    : 2026-08-24 .. 2026-08-30
//   current week : 2026-08-31 .. 2026-09-06
//   next week    : 2026-09-07 .. 2026-09-13
const now = new Date(2026, 8, 3, 10, 0, 0); // month is 0-based -> September

console.log("== weekRanges ==");
const w = weekRanges(now);
check("last from Monday", w.last.from, "2026-08-24");
check("last to Sunday", w.last.to, "2026-08-30");
check("current from Monday", w.current.from, "2026-08-31");
check("current to Sunday", w.current.to, "2026-09-06");
check("next from Monday", w.next.from, "2026-09-07");
check("next to Sunday", w.next.to, "2026-09-13");

// A Sunday reference should still map to the same Mon-Sun week.
const sun = weekRanges(new Date(2026, 8, 6, 23, 0, 0));
check("sunday stays in current week", sun.current.from, "2026-08-31");
check("sunday current to", sun.current.to, "2026-09-06");

console.log("== bucketChanges ==");
const changes = [
  // implemented last week: start_date in last week, Closed
  { number: "CHG001", short_description: "impl a", state: "Closed", cmdb_ci: "RMS (prd)",
    start_date: "2026-08-25 09:00:00", review_status: "Successful" },
  // failed last week: review_status Unsuccessful
  { number: "CHG002", short_description: "fail b", state: "Closed", cmdb_ci: "STAFF (prd)",
    start_date: "2026-08-26 09:00:00", review_status: "Unsuccessful" },
  // planned next week
  { number: "CHG003", short_description: "plan c", state: "Scheduled", cmdb_ci: "RIBI (prd)",
    start_date: "2026-09-08 09:00:00" },
  // last week, in progress (Implement), not failed/cancelled -> IMPLEMENTED
  // (implemented no longer requires terminal Closed state)
  { number: "CHG004", short_description: "open d", state: "Implement", cmdb_ci: "OPS (prd)",
    start_date: "2026-08-27 09:00:00" },
  // current week -> in none of the three buckets (only last/next week matter)
  { number: "CHG005", short_description: "old e", state: "Closed", cmdb_ci: "X (prd)",
    start_date: "2026-09-02 09:00:00" },
  // u_failure flag failed, last week
  { number: "CHG006", short_description: "fail f", state: "Closed", cmdb_ci: "Y (prd)",
    start_date: "2026-08-28 09:00:00", u_failure: "true" },
  // last week but Cancelled -> excluded from every bucket
  { number: "CHG007", short_description: "cancel g", state: "Cancelled", cmdb_ci: "Z (prd)",
    start_date: "2026-08-29 09:00:00" }
];
const b = bucketChanges(changes, w);
check("implemented count", b.implemented.length, 2);
check("implemented includes CHG001 (Closed)", b.implemented.some((r) => r.crNumber === "CHG001"), true);
check("implemented includes CHG004 (Implement, not yet closed)", b.implemented.some((r) => r.crNumber === "CHG004"), true);
check("failed count", b.failed.length, 2);
check("failed includes CHG002", b.failed.some((r) => r.crNumber === "CHG002"), true);
check("failed includes CHG006 (u_failure)", b.failed.some((r) => r.crNumber === "CHG006"), true);
check("planned count", b.planned.length, 1);
check("planned cr", b.planned[0].crNumber, "CHG003");
check("current-week change excluded", b.implemented.concat(b.planned, b.failed).some((r) => r.crNumber === "CHG005"), false);
check("cancelled change excluded", b.implemented.concat(b.planned, b.failed).some((r) => r.crNumber === "CHG007"), false);
check("implemented date is a serial number", typeof b.implemented[0].date, "number");

console.log("== bucketChanges TZ boundaries (regression) ==");
// start_date at the extreme edges of last week must stay in-window regardless
// of the runner's local timezone. parseSnDisplayMs reads the SN display value
// as UTC, so the window bounds must be UTC too (windowFrom uses Date.UTC).
const edgeChanges = [
  { number: "EDGE1", short_description: "monday 00:00", state: "Closed", cmdb_ci: "A (prd)",
    start_date: "2026-08-24 00:00:00", review_status: "Successful" },
  { number: "EDGE2", short_description: "sunday 23:59", state: "Closed", cmdb_ci: "B (prd)",
    start_date: "2026-08-30 23:59:00", review_status: "Successful" }
];
const eb = bucketChanges(edgeChanges, w);
check("monday-00:00 edge implemented", eb.implemented.some((r) => r.crNumber === "EDGE1"), true);
check("sunday-23:59 edge implemented", eb.implemented.some((r) => r.crNumber === "EDGE2"), true);
check("edge implemented count", eb.implemented.length, 2);

console.log("== keyIncidents ==");
const incidents = [
  { number: "INC001", priority: "1 - Critical", state: "Resolved", cmdb_ci: "RMS (prd)",
    short_description: "p1 last week", resolved_at: "2026-08-25 12:00:00", close_notes: "root cause X" },
  { number: "INC002", priority: "2 - High", state: "Closed", cmdb_ci: "SYS (prd)",
    short_description: "p2 last week", resolved_at: "2026-08-29 08:00:00" },
  { number: "INC003", priority: "3 - Moderate", state: "Resolved",
    short_description: "p3 excluded", resolved_at: "2026-08-25 08:00:00" },
  { number: "INC004", priority: "1 - Critical", state: "Resolved",
    short_description: "p1 current week excluded", resolved_at: "2026-09-02 08:00:00" }
];
const ki = keyIncidents(incidents, w);
check("key incident count", ki.length, 2);
check("first is INC001", ki[0].incidentNumber, "INC001");
check("root cause carried", ki[0].rootCauseResolution, "root cause X");
check("p3 excluded", ki.some((r) => r.incidentNumber === "INC003"), false);
check("current week p1 excluded", ki.some((r) => r.incidentNumber === "INC004"), false);

console.log("== buildSummaryDetails ==");
const details = buildSummaryDetails(incidents, changes, now);
check("details keyIncidents", details.keyIncidents.length, 2);
check("details implemented", details.changesImplemented.length, 2);
check("details failed", details.changesFailed.length, 2);
check("details planned", details.changesPlanned.length, 1);
check("details weeks.last from", details.weeks.last.from, "2026-08-24");

console.log(`\n${failed ? `FAILED ${failed}` : "ALL PASSED"}`);
process.exit(failed ? 1 : 0);

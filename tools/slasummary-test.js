#!/usr/bin/env node
import { buildSlaSummary, buildSlaSummaryRows } from "../analysis/slasummary.js";

let failed = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}

const fmt = v => v;

const rows = [
  { number: "INC-P1-A", priority: "1 - Critical", state: "Resolved", createdOn: "10-08-2026 00:00:00", assignTimeUtcIso: "2026-08-10T00:00:00.000Z", acknTimeUtcIso: "2026-08-10T00:10:00.000Z", resolvedAt: "10-08-2026 00:30:00" },
  { number: "INC-P1-B", priority: "1 - Critical", state: "Resolved", createdOn: "10-08-2026 00:00:00", assignTimeUtcIso: "2026-08-10T00:00:00.000Z", acknTimeUtcIso: "2026-08-10T00:25:00.000Z", resolvedAt: "10-08-2026 03:00:00" },
  { number: "INC-P1-C", priority: "1 - Critical", state: "Resolved", createdOn: "10-08-2026 00:00:00", assignTimeUtcIso: "2026-08-10T00:00:00.000Z", acknTimeUtcIso: "2026-08-10T00:05:00.000Z", resolvedAt: "10-08-2026 05:00:00" },
  { number: "INC-P2-A", priority: "2 - High", state: "Resolved", createdOn: "10-08-2026 00:00:00", assignTimeUtcIso: "2026-08-10T00:00:00.000Z", acknTimeUtcIso: "2026-08-10T00:10:00.000Z", resolvedAt: "10-08-2026 05:00:00" },
  { number: "INC-P3-A", priority: "3 - Moderate", state: "Resolved", createdOn: "10-08-2026 08:00:00", assignTimeUtcIso: "2026-08-10T08:00:00.000Z", acknTimeUtcIso: "2026-08-10T09:30:00.000Z", resolvedAt: "10-08-2026 17:00:00" },
  { number: "REQ-P2-X", priority: "2 - High", state: "Closed", createdOn: "10-08-2026 00:00:00", assignTimeUtcIso: "2026-08-10T00:00:00.000Z", resolvedAt: "12-08-2026 00:00:00" },
  { number: "PTASK-P1-X", priority: "1 - Critical", state: "Resolved", createdOn: "10-08-2026 00:00:00", assignTimeUtcIso: "2026-08-10T00:00:00.000Z", acknTimeUtcIso: "2026-08-10T00:05:00.000Z", resolvedAt: "10-08-2026 00:30:00" },
  { number: "PTASK-P4-X", priority: "4 - Low", state: "Resolved", createdOn: "10-08-2026 00:00:00", assignTimeUtcIso: "2026-08-10T00:00:00.000Z", acknTimeUtcIso: "2026-08-10T00:10:00.000Z", resolvedAt: "10-08-2026 05:00:00" }
];

const s = buildSlaSummary(rows, fmt);
const find = (metric, category, sla) =>
  s.items.find(i => i.metric === metric && i.category === category && i.sla === sla);

console.log("== totals ==");
check("block1 incidents by severity", JSON.stringify(s.incidentTotals), JSON.stringify({ 1: 3, 2: 1, 3: 1, 4: 0 }));
check("items length 17", s.items.length, 17);
check("computedAt ISO", /^\d{4}-\d{2}-\d{2}T/.test(s.computedAt), true);

console.log("== P1 resolve ==");
check("within 1 hour count", find("Time to Resolve", "Severity 1 Incidents", "Within 1 hour").count, 1);
check("within 1 hour total", find("Time to Resolve", "Severity 1 Incidents", "Within 1 hour").total, 3);
check("within 1 hour actual", find("Time to Resolve", "Severity 1 Incidents", "Within 1 hour").actual, 0.33);
check("within 1 hour amber", find("Time to Resolve", "Severity 1 Incidents", "Within 1 hour").status, "AMBER");
check("within 2 hours (duration) count", find("Time to Resolve", "Severity 1 Incidents", "Within 2 hours").count, 1);
check("within 4 hours count", find("Time to Resolve", "Severity 1 Incidents", "Within 4 hours").count, 2);

console.log("== P2 resolve ==");
check("within 2 hours flagMin count", find("Time to Resolve", "Severity 2 Incidents", "Within 2 hours").count, 0);
check("within 6 hours (duration) count", find("Time to Resolve", "Severity 2 Incidents", "Within 6 hours").count, 1);
check("within 8 hours flagMax count", find("Time to Resolve", "Severity 2 Incidents", "Within 8 hours").count, 1);

console.log("== P3 resolve ==");
check("within 1 working day count", find("Time to Resolve", "Severity 3 Incidents", "Within 1 working day").count, 0);
check("within 5 working days count", find("Time to Resolve", "Severity 3 Incidents", "Within 5 working days").count, 1);
check("within 5 working days green", find("Time to Resolve", "Severity 3 Incidents", "Within 5 working days").status, "GREEN");

console.log("== P4 (no tickets) ==");
check("P4 resolve total 0", find("Time to Resolve", "Severity 4 Incidents", "Within 10 working days").total, 0);
check("P4 resolve green when empty", find("Time to Resolve", "Severity 4 Incidents", "Within 10 working days").status, "GREEN");
check("P4 respond red when empty", find("Time to Respond", "Severity 4 Incidents", "Within 3 business hours").status, "RED");

console.log("== respond ==");
check("P1 within 15 minutes count", find("Time to Respond", "Severity 1 Incidents", "Within 15 minutes").count, 2);
check("P1 within 15 minutes red (100% breach rule)", find("Time to Respond", "Severity 1 Incidents", "Within 15 minutes").status, "RED");
check("P2 within 30 minutes count", find("Time to Respond", "Severity 2 Incidents", "Within 30 minutes").count, 1);
check("P3 within 2 business hours count", find("Time to Respond", "Severity 3 Incidents", "Within 2 business hours").count, 1);
check("P3 within 2 business hours green", find("Time to Respond", "Severity 3 Incidents", "Within 2 business hours").status, "GREEN");

console.log("== problem (block 2) ==");
const kelHigh = s.items.find(i => i.metric === "Known Error Logging" && i.category === "High/High");
const kelRest = s.items.find(i => i.metric === "Known Error Logging" && i.category === "All other priorities except High");
const reocc = s.items.find(i => i.metric === "Reoccuring Incident - Problem creation");
check("KEL high count", kelHigh.count, 1);
check("KEL high total", kelHigh.total, 1);
check("KEL high no status write", kelHigh.writeStatus, false);
check("KEL rest count", kelRest.count, 1);
check("KEL rest total", kelRest.total, 1);
check("reoccuring total = all problems", reocc.total, 2);
check("reoccuring count", reocc.count, 2);

console.log("== row builder ==");
const items = buildSlaSummaryRows(rows, fmt);
check("buildSlaSummaryRows mirrors items", items.length, s.items.length);
check("RFS rows excluded from incident totals", JSON.stringify(buildSlaSummary(rows, fmt).incidentTotals[2]), "1");

console.log(`\nslasummary: ${failed ? failed + " FAILED" : "all passed"}`);
process.exit(failed ? 1 : 0);
#!/usr/bin/env node
import { ReportService } from "../services/report-service.ts";
import { buildReport } from "../core/report.ts";

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}

const svc = new ReportService();

const identity = (v) => String(v);
const shiftPlusDay = (v) => {
  const d = new Date(String(v));
  if (isNaN(d.getTime())) return String(v);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
};

// buildReport caches __report on the row keyed WITHOUT the formatter, so every
// call must get a fresh row object — otherwise the second fmt reuses the first.
const mkRow = () => ({
  number: "INC001",
  priority: 2,
  state: "Resolved",
  createdOn: "2026-01-05T08:00:00Z",
  assignTimeUtcIso: "2026-01-05T09:00:00Z",
  acknTimeUtcIso: "2026-01-05T09:30:00Z",
  suspendTimeUtcIso: "",
  resumeTimeUtcIso: "",
  resolvedAt: "2026-01-05T17:00:00Z"
});

console.log("== ReportService.rep — fmt normalises dates into the SLA math ==");

check("identity fmt: 8h incident time",
  svc.rep(mkRow(), identity).incCurrentHours,
  "8:00:00");

check("day-shifted fmt changes derived SLA (resolvedAt does NOT go through fmt)",
  svc.rep(mkRow(), shiftPlusDay).incCurrentHours,
  "0:00:00");

check("slaBreach baseline under identity fmt",
  svc.rep(mkRow(), identity).slaBreach,
  "RM");

check("slaBreach flips once the formatter shifts assigned past resolved",
  svc.rep(mkRow(), shiftPlusDay).slaBreach,
  "R");

console.log("== ReportService.slaSummary — a non-identity fmt moves counts ==");

const mkP1Row = () => ({
  number: "INC002",
  priority: 1,
  state: "Resolved",
  createdOn: "2026-01-05T08:00:00Z",
  assignTimeUtcIso: "2026-01-05T09:00:00Z",
  acknTimeUtcIso: "2026-01-05T09:30:00Z",
  suspendTimeUtcIso: "",
  resumeTimeUtcIso: "",
  resolvedAt: "2026-01-05T11:00:00Z"
});

function item(s, sla) {
  const it = s.items.find((i) => i.sla === sla);
  return it ? { count: it.count, total: it.total, status: it.status } : null;
}

check("identity fmt: 2h resolution misses the 1h target",
  item(svc.slaSummary([mkP1Row()], identity), "Within 1 hour"),
  { count: 0, total: 1, status: "AMBER" });

check("shifted fmt: clamping to 0h makes the same row count as met",
  item(svc.slaSummary([mkP1Row()], shiftPlusDay), "Within 1 hour"),
  { count: 1, total: 1, status: "GREEN" });

check("incidentTotals unchanged by the formatter",
  svc.slaSummary([mkP1Row()], identity).incidentTotals,
  { 1: 1, 2: 0, 3: 0, 4: 0 });

console.log("== pure core still reachable through the service boundary ==");

check("core buildReport identity fmt direct",
  buildReport(mkRow(), identity).incCurrentHours,
  "8:00:00");

check("slaSummaryRows returns SlaSummaryItem[]",
  (Array.isArray(svc.slaSummaryRows([mkP1Row()], identity))
    && svc.slaSummaryRows([mkP1Row()], identity).every((i) => typeof i.sla === "string" && typeof i.status === "string")),
  true);

process.exit(failed ? 1 : 0);
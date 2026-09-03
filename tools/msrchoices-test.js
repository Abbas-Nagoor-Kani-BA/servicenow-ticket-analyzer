#!/usr/bin/env node
import {
  MSR_DEFAULT_LISTS, mergeMsrLists, normResolution, msrStatus, msrType,
  isClassifyEligible,
  rootCauseFor, parseDisplayMs, excelSerialFromMs, displayToSerial, hmsToDays
} from "../core/msrchoices.ts";

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}
function close(name, got, want, eps = 1e-8) {
  const ok = typeof got === "number" && Math.abs(got - want) <= eps;
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : ` got=${got} want=${want}`}`);
}

console.log("== default lists (harvested from msr.xlsx Variables sheet) ==");
check("opCo", MSR_DEFAULT_LISTS.opCo, ["BA", "IB", "EI"]);
check("type", MSR_DEFAULT_LISTS.type, ["Incident", "RFS", "P_Ticket"]);
check("status", MSR_DEFAULT_LISTS.status, ["In Progress", "Suspended", "Closed", "Triaged"]);
check("resolution", MSR_DEFAULT_LISTS.resolution,
  ["Workaround solution", "Permanent solution", "Verification only", "Not applicable"]);
check("duplicate", MSR_DEFAULT_LISTS.duplicate, ["Yes", "No"]);
if (MSR_DEFAULT_LISTS.queue.length !== 36) { failed++; console.log(`  FAIL queue count ${MSR_DEFAULT_LISTS.queue.length} want 36`); }
else console.log("  ok  queue count 36");
if (MSR_DEFAULT_LISTS.subCategory.length !== 33) { failed++; console.log(`  FAIL subCategory count ${MSR_DEFAULT_LISTS.subCategory.length} want 33`); }
else console.log("  ok  subCategory count 33");
if (MSR_DEFAULT_LISTS.rootCause.Incident.length !== 24) { failed++; console.log(`  FAIL incident rc count ${MSR_DEFAULT_LISTS.rootCause.Incident.length} want 24`); }
else console.log("  ok  incident root-cause count 24");
if (MSR_DEFAULT_LISTS.rootCause.P_Ticket.length !== 12) { failed++; console.log(`  FAIL p_ticket rc count`); }
else console.log("  ok  p_ticket root-cause count 12");
check("RFS list empty in source workbook", MSR_DEFAULT_LISTS.rootCause.RFS, []);

console.log("\n== mergeMsrLists ==");
check("null override returns defaults",
  mergeMsrLists(null).resolution, MSR_DEFAULT_LISTS.resolution);
check("partial array replaces whole list",
  mergeMsrLists({ status: ["Closed"] }).status, ["Closed"]);
check("untouched lists survive partial override",
  mergeMsrLists({ status: ["Closed"] }).opCo, MSR_DEFAULT_LISTS.opCo);
check("rootCause deep merge",
  mergeMsrLists({ rootCause: { RFS: ["Custom"] } }).rootCause,
  { Incident: MSR_DEFAULT_LISTS.rootCause.Incident, RFS: ["Custom"], P_Ticket: MSR_DEFAULT_LISTS.rootCause.P_Ticket });
check("dupes and blanks dropped case-insensitively",
  mergeMsrLists({ opCo: ["BA", " ba ", "", "IB"] }).opCo, ["BA", "IB"]);

console.log("\n== normResolution (MSR wording) ==");
check("legacy Permanent fix", normResolution("Permanent fix"), "Permanent solution");
check("legacy Workaround", normResolution("Workaround"), "Workaround solution");
check("already canonical", normResolution("Permanent solution"), "Permanent solution");
check("fuzzy permanant fix", normResolution("Permanant fix"), "Permanent solution");
check("temporary wording", normResolution("Temporary fix until vendor patch"), "Workaround solution");
check("verification", normResolution("Verification only"), "Verification only");
check("not applicable", normResolution("N/A"), "Not applicable");
check("unknown passes through untouched", normResolution("Vendor hotfix applied"), "Vendor hotfix applied");
check("empty", normResolution(""), "");

console.log("\n== msrStatus ==");
check("In Progress", msrStatus("In Progress"), "In Progress");
check("On Hold -> Suspended", msrStatus("On Hold"), "Suspended");
check("Closed -> Closed", msrStatus("Closed"), "Closed");
check("Resolved -> Closed", msrStatus("Resolved"), "Closed");
check("Closed Complete -> Closed", msrStatus("Closed Complete"), "Closed");
check("Triaged -> Triaged", msrStatus("Triaged"), "Triaged");
check("New -> In Progress fallback", msrStatus("New"), "In Progress");
check("empty -> empty", msrStatus(""), "");

console.log("\n== msrType / rootCauseFor ==");
check("INC", msrType("INC1234567"), "Incident");
check("REQ", msrType("REQ0010011"), "RFS");
check("SCTASK", msrType("SCTASK0001234"), "RFS");
check("PRB", msrType("PRB0001234"), "P_Ticket");
check("PTASK (legacy)", msrType("PTASK0001234"), "P_Ticket");
check("unknown", msrType("CHG0001"), "");
check("root cause via msrType(PRB) is the P_Ticket list",
  rootCauseFor(MSR_DEFAULT_LISTS.rootCause, msrType("PRB0001234")).includes("User error - data"), true);
check("root cause via msrType(SCTASK) is the RFS list",
  rootCauseFor(MSR_DEFAULT_LISTS.rootCause, msrType("SCTASK0001234")), []);

console.log("\n== isClassifyEligible (closed Incident/RFS only) ==");
check("INC + Resolved", isClassifyEligible({ number: "INC1", state: "Resolved" }), true);
check("INC + Closed Complete", isClassifyEligible({ number: "INC1", state: "Closed Complete" }), true);
check("REQ + Closed (RFS)", isClassifyEligible({ number: "REQ1", state: "Closed" }), true);
check("SCTASK + Resolved (RFS)", isClassifyEligible({ number: "SCTASK1", state: "Resolved" }), true);
check("INC + In Progress -> false", isClassifyEligible({ number: "INC1", state: "In Progress" }), false);
check("REQ + Open -> false", isClassifyEligible({ number: "REQ1", state: "Open" }), false);
check("PRB + Closed -> false (not Incident/RFS)", isClassifyEligible({ number: "PRB1", state: "Closed" }), false);
check("PTASK + Resolved -> false", isClassifyEligible({ number: "PTASK1", state: "Resolved" }), false);
check("CHG + Closed -> false", isClassifyEligible({ number: "CHG1", state: "Closed" }), false);
check("null row -> false", isClassifyEligible(null), false);
check("root cause for Incident", rootCauseFor(MSR_DEFAULT_LISTS.rootCause, "Incident").includes("Application bug"), true);
check("root cause for P_Ticket includes User error - data",
  rootCauseFor(MSR_DEFAULT_LISTS.rootCause, "P_Ticket").includes("User error - data"), true);
check("root cause for RFS empty", rootCauseFor(MSR_DEFAULT_LISTS.rootCause, "RFS"), []);
check("root cause unknown type", rootCauseFor(MSR_DEFAULT_LISTS.rootCause, "Change"), []);

console.log("\n== parseDisplayMs ==");
check("ISO", parseDisplayMs("2026-08-10 05:36:40"),
  Date.UTC(2026, 7, 10, 5, 36, 40));
check("day-first dash", parseDisplayMs("10-08-2026 11:06:40"),
  Date.UTC(2026, 7, 10, 11, 6, 40));
check("day-first dot", parseDisplayMs("10.08.2026 11:06"),
  Date.UTC(2026, 7, 10, 11, 6, 0));
check("US slash", parseDisplayMs("08/10/2026 11:06:40 PM"),
  Date.UTC(2026, 7, 10, 23, 6, 40));
check("empty", parseDisplayMs(""), null);

console.log("\n== excel serials ==");
close("2000-01-01 anchor serial 36526", displayToSerial("01-01-2000 00:00:00"), 36526, 1e-9);
close("serial from ms", excelSerialFromMs(Date.UTC(1970, 0, 1)), 25569, 1e-9);
check("invalid date -> null", displayToSerial("garbage"), null);
check("blank -> null", displayToSerial(""), null);

console.log("\n== hmsToDays (MSR stores decimal days) ==");
close("28:20:30 -> ~1.18090277778 days", hmsToDays("28:20:30"),
  (28 + 20 / 60 + 30 / 3600) / 24);
close("00:35:03 response SLA", hmsToDays("00:35:03"),
  (35 * 60 + 3) / 3600 / 24);
check("empty -> empty string", hmsToDays(""), "");

console.log(`\nmsrchoices: ${failed ? failed + " FAILED" : "all passed"}`);
process.exit(failed ? 1 : 0);

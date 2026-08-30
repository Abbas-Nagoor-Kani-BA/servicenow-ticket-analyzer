#!/usr/bin/env node
import { computeDurations } from "../core/durations.ts";

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}

console.log("== computeDurations — assign→ackn ==");

check("30 minutes", computeDurations({
  assignTimeUtcIso: "2026-01-05T09:00:00.000Z",
  acknTimeUtcIso: "2026-01-05T09:30:00.000Z"
}).assignToAckn, "0:30:00");

check("one day exactly -> 24:00:00", computeDurations({
  assignTimeUtcIso: "2026-01-05T09:00:00.000Z",
  acknTimeUtcIso: "2026-01-06T09:00:00.000Z"
}).assignToAckn, "24:00:00");

console.log("== computeDurations — assign→resolve (raw UTC resolvedAt) ==");

check("raw value without suffix", computeDurations({
  assignTimeUtcIso: "2026-01-05T09:00:00.000Z",
  resolvedAtRaw: "2026-01-05 17:00:00"
}).assignToResolve, "8:00:00");

check("raw value with T and Z", computeDurations({
  assignTimeUtcIso: "2026-01-05T09:00:00.000Z",
  resolvedAtRaw: "2026-01-05T17:00:00Z"
}).assignToResolve, "8:00:00");

console.log("== computeDurations — suspend total ==");

check("1h15 suspend window", computeDurations({
  suspendTimeUtcIso: "2026-01-05T10:00:00.000Z",
  resumeTimeUtcIso: "2026-01-05T11:15:00.000Z"
}).suspendTotal, "1:15:00");

console.log("== computeDurations — missing / inverted / zero ==");

check("empty row -> all empty", computeDurations({}), { assignToAckn: "", assignToResolve: "", suspendTotal: "" });
check("assign only -> resolve empty", computeDurations({ assignTimeUtcIso: "2026-01-05T09:00:00.000Z" }), { assignToAckn: "", assignToResolve: "", suspendTotal: "" });
check("ackn before assign -> empty (inverted)", computeDurations({
  assignTimeUtcIso: "2026-01-05T09:00:00.000Z",
  acknTimeUtcIso: "2026-01-05T08:00:00.000Z"
}).assignToAckn, "");
check("equal endpoints -> empty (zero)", computeDurations({
  assignTimeUtcIso: "2026-01-05T09:00:00.000Z",
  acknTimeUtcIso: "2026-01-05T09:00:00.000Z"
}).assignToAckn, "");
check("resolved before assign -> empty", computeDurations({
  assignTimeUtcIso: "2026-01-05T09:00:00.000Z",
  resolvedAtRaw: "2026-01-05 08:00:00"
}).assignToResolve, "");
check("unparseable stamps -> empty, no throw", computeDurations({
  assignTimeUtcIso: "garbage",
  acknTimeUtcIso: "2026-01-05T09:30:00.000Z"
}).assignToAckn, "");

process.exit(failed ? 1 : 0);
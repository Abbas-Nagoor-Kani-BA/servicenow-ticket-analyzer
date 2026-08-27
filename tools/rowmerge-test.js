#!/usr/bin/env node
import { mergeRows } from "../lib/rowmerge.js";

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}

const a = { sysId: "1", number: "INC1", state: "Old" };
const b = { sysId: "1", number: "INC1", state: "New" };
const c = { sysId: "2", number: "INC2", state: "Other" };

check("new row replaces old by sysId", mergeRows([a], [b])[0].state, "New");
check("disjoint rows unioned in order", mergeRows([a], [c]).map(r => r.sysId), ["1", "2"]);
check("falls back to number when no sysId",
  mergeRows([{ number: "INC9", v: 1 }], [{ number: "INC9", v: 2 }])[0].v, 2);
check("empty inputs safe", mergeRows([], []), []);

console.log(`\nrowmerge: ${failed ? failed + " FAILED" : "all passed"}`);
process.exit(failed ? 1 : 0);

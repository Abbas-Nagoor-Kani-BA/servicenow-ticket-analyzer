#!/usr/bin/env node
import * as Journal from "../core/journal.ts";

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}
console.log("== parseEntries ==");
const blob = `2026-08-20 09:14:02 - john.doe (Work notes)
Checked Datadog, alert auto-resolved.

2026-08-19 17:40:11 - system
Monitoring.`;
const parsed = Journal.parseEntries(blob, "Work note");
check("two entries parsed", parsed.length, 2);
check("first entry author cleaned", parsed[0].author, "john.doe (Work notes)");
check("first entry time", parsed[0].time, "2026-08-20 09:14:02");
check("multi-line body preserved", parsed[1].text, "Monitoring.");
check("empty blob", Journal.parseEntries("", "X"), []);
check("leading orphan line becomes single entry",
  Journal.parseEntries("just some text", "X")[0].text, "just some text");

console.log("\n== cleanAuthor / authorInitials ==");
check("strips field suffix", Journal.cleanAuthor("john.doe (Work notes)"), "john doe");
check("strips email domain", Journal.cleanAuthor("abbas.nagoor.kani@ba.com"), "abbas nagoor kani");
check("initials first+last", Journal.authorInitials("Gopinath Maruthachalam"), "GM");
check("initials single word", Journal.authorInitials("System"), "SS");
check("initials empty", Journal.authorInitials(""), "?");

console.log("\n== build (row -> activity entries) ==");
const row = {
  number: "INC1",
  shortDescription: "AIMS LOUNGE slowness issue",
  resolvedAt: "25-08-2026 11:35:00",
  workNotes: blob,
  comments: `2026-08-21 08:00:00 - jane.smith\nUser confirmed fix.`,
  closeNotes: "Root cause: stale cache."
};
const entries = Journal.build(row, ms => Date.parse(ms.replace(/(\d{2})-(\d{2})-(\d{4})/, "$3-$2-$1")));
check("work notes + comment + resolution", entries.length, 4);
check("classes assigned", entries.map(e => e.cls), ["wn", "wn", "cm", "rn"]);
const rn = entries.find(e => e.cls === "rn");
check("resolution note stamped from resolvedAt", rn.sort.length >= 19, true);
check("summary NOT part of stream", entries.some(e => e.cls === "sum"), false);

console.log("\n== group (same author + same time merge) ==");
const stream = [
  { cls: "wn", label: "Work note", author: "GM", time: "24-08-2026 18:04:41", sort: "2026-08-24" },
  { cls: "cm", label: "Customer comment", author: "GM", time: "24-08-2026 18:04:41", sort: "2026-08-24" },
  { cls: "cm", label: "Customer comment", author: "jane.smith", time: "21-08-2026 08:00:00", sort: "2026-08-21" }
];
const groups = Journal.group(stream);
check("same-time posts merged into one card", groups.length, 2);
check("merged card holds both posts", groups[0].items.length, 2);
check("separate author stays separate card", groups[1].items.length, 1);
check("different time splits card", groups[1].author, "jane.smith");

console.log("\n== sortKey ==");
check("prefers sort over time", Journal.sortKey({ sort: "a", time: "b" }), "a");
check("falls back to time", Journal.sortKey({ time: "b" }), "b");

console.log(`\njournal: ${failed ? failed + " FAILED" : "all passed"}`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
import { ExtractService } from "../services/extract-service.ts";
import { extractHeuristic } from "../core/aiextract.ts";

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}

const svc = new ExtractService();

console.log("== ExtractService.applyExtraction (per-row apply loop) ==");

check("stats over 3 rows with 2 filled",
  svc.applyExtraction([
    { closeNotes: "root cause: Expired SAML certificate" },
    { closeNotes: "Replaced cert. permanent solution applied." },
    { closeNotes: "" }
  ]),
  { total: 3, withNotes: 2, filled: 2 });

check("rows already fully resolved are skipped",
  svc.applyExtraction([
    { closeNotes: "root cause: bad cert", solutionType: "Permanent solution", rootCause: "bad cert" }
  ]),
  { total: 1, withNotes: 1, filled: 0 });

check("fills only the missing field, keeps existing value",
  (() => {
    const row = { closeNotes: "resolution type: Workaround", rootCause: "full disk" };
    const out = svc.applyExtraction([row]);
    return String(row.solutionType) === "Workaround solution" && String(row.rootCause) === "full disk" && out.filled === 1 && row.parseReview === undefined;
  })(),
  true);

check("medium-confidence root cause fills and flags parseReview",
  (() => {
    const row = { closeNotes: "The system went down because the cache directory filled up completely; the root cause: corrupted cache files" };
    svc.applyExtraction([row]);
    return String(row.rootCause) === "corrupted cache files" && row.parseReview === true;
  })(),
  true);

check("smoke: sane default when no notes exist",
  svc.applyExtraction([
    {},
    { closeNotes: null },
    { closeNotes: "   " }
  ]),
  { total: 3, withNotes: 0, filled: 0 });

check("numeric closeNotes never crash (hardened)", (() => {
  let out = null;
  try {
    out = svc.applyExtraction([{ closeNotes: 12345 }]);
  } catch {
    return null;
  }
  return JSON.stringify(out) === JSON.stringify({ total: 1, withNotes: 1, filled: 0 });
})(), true);

console.log("== heuristic still pure (unchanged) ==");
check("extractHeuristic direct call",
  extractHeuristic("root cause: Expired SAML certificate"),
  { solutionType: "", rootCause: "Expired SAML certificate", confidence: { solutionType: "", rootCause: "high" } });

process.exit(failed ? 1 : 0);
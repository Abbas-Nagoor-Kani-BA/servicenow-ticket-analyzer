import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveOutcome, resolvePick, stripCommonWords } from "../worker/ml-classify.ts";

// These cover the cache-staleness fix: the cache now stores the RAW per-engine
// picks (ml + det), and the verdict is re-derived with the CURRENT rule on every
// read (resolveOutcome). The deterministic cascade is authoritative — a verdict
// frozen by an older decision rule can therefore never be served stale, and the
// tie that the old ML-authoritative rule mislabeled ml now resolves to det.

const RC = {
  ml: { value: "Application bug", confidence: 1.0, source: "ml" },
  det: { value: "Application bug", confidence: 0.4, source: "heuristic" }
};

test("resolveOutcome: deterministic label is decisive even under a confident ML pick", () => {
  const out = resolveOutcome({ rootCause: RC, solutionType: RC });
  assert.equal(out.rootCause.source, "heuristic");
  assert.equal(out.rootCause.value, "Application bug");
});

test("resolveOutcome: the 100% ML vs 100% heuristic tie now resolves to det (previously ML)", () => {
  const p = {
    ml: { value: "Permanent solution", confidence: 1.0, source: "ml" },
    det: { value: "Permanent solution", confidence: 1.0, source: "heuristic" }
  };
  const out = resolveOutcome({ rootCause: p, solutionType: p });
  assert.equal(out.solutionType.source, "heuristic");
  assert.equal(out.solutionType.value, "Permanent solution");
});

test("resolveOutcome: ML below floor (or absent) falls through to heuristic", () => {
  const p = { ml: null, det: { value: "Workaround", confidence: 0.32, source: "heuristic" } };
  const out = resolveOutcome({ rootCause: p, solutionType: p });
  assert.equal(out.solutionType.source, "heuristic");
  assert.equal(out.solutionType.value, "Workaround");
});

test("resolveOutcome: deterministic label overrides ML regardless of confidence", () => {
  const p = {
    ml: { value: "Certificate expiry", confidence: 0.38, source: "ml" },
    det: { value: "Hardware", confidence: 0.5, source: "heuristic" }
  };
  const out = resolveOutcome({ rootCause: p, solutionType: p });
  assert.equal(out.rootCause.source, "heuristic");
  assert.equal(out.rootCause.value, "Hardware");
});

test("resolveOutcome: ML fills the cell when deterministic produced nothing", () => {
  const p = {
    ml: { value: "Certificate expiry", confidence: 0.72, source: "ml" },
    det: { value: null, confidence: 0, source: "heuristic" }
  };
  const out = resolveOutcome({ rootCause: p, solutionType: p });
  assert.equal(out.rootCause.source, "ml");
  assert.equal(out.rootCause.value, "Certificate expiry");
});

test("resolvePick: ML has no say when the deterministic cascade produced a label", () => {
  const ml = { value: "Permanent solution", confidence: 1.0, source: "ml" };
  const det = { value: "Permanent solution", confidence: 1.0, source: "heuristic" };
  const r = resolvePick(ml, det);
  assert.equal(r.source, "heuristic");
});

test("resolvePick: ML fills a cell the deterministic left blank", () => {
  const ml = { value: "Hardware", confidence: 0.4, source: "ml" };
  const det = { value: null, confidence: 0, source: "heuristic" };
  const r = resolvePick(ml, det);
  assert.equal(r.source, "ml");
  assert.equal(r.value, "Hardware");
});

test("stripCommonWords drops function words but keeps negation/labels", () => {
  const out = stripCommonWords("The user had a problem and the network was down.");
  assert.equal(out, "user problem network down");
  assert.ok(!out.includes("the") && !out.includes("and") && !out.includes("had"));
});

test("stripCommonWords preserves negation and MSR-relevant words", () => {
  assert.equal(stripCommonWords("This is not an issue at all"), "not issue");
  assert.equal(stripCommonWords("not"), "not");
  assert.equal(stripCommonWords("access denied"), "access denied");
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { pickExact, resolvePick } from "../worker/ml-classify.ts";

const M = (value, confidence) => ({ value, confidence, source: "ml" });
const H = (value, confidence) => ({ value, confidence, source: "heuristic" });

test("pickExact: any non-null ML label is stamped ml regardless of confidence", () => {
  const r = pickExact(M("Hardware", 0.08), H("Software", 0.9));
  assert.equal(r.value, "Hardware");
  assert.equal(r.source, "ml");
  assert.equal(r.confidence, 0.08);
});

test("pickExact: ML wins an exact-confidence tie at/above floor", () => {
  const r = pickExact(M("Hardware", 0.6), H("Software", 0.55));
  assert.equal(r.value, "Hardware");
  assert.equal(r.source, "ml");
});

test("pickExact: ML wins even when the heuristic is far more confident", () => {
  const r = pickExact(M("Permanent solution", 0.39), H("Permanent solution", 0.76));
  assert.equal(r.value, "Permanent solution");
  assert.equal(r.source, "ml");
});

test("pickExact: ML wins when its confidence equals the heuristic's", () => {
  const r = pickExact(M("Hardware", 0.8), H("Software", 0.8));
  assert.equal(r.value, "Hardware");
  assert.equal(r.source, "ml");
});

test("pickExact: ML empty value -> heuristic", () => {
  const r = pickExact(M(null, 0.9), H("Software", 0.4));
  assert.equal(r.value, "Software");
  assert.equal(r.source, "heuristic");
});

test("pickExact: ML empty-string value -> heuristic", () => {
  const r = pickExact(M("", 0.9), H("Software", 0.4));
  assert.equal(r.value, "Software");
  assert.equal(r.source, "heuristic");
});

test("pickExact: ML clear win is stamped ml", () => {
  const r = pickExact(M("Hardware", 0.91), H("Software", 0.4));
  assert.equal(r.value, "Hardware");
  assert.equal(r.source, "ml");
});

test("resolvePick: ML label fills the cell and is stamped ml", () => {
  const r = resolvePick(M("Configuration Issue", 0.08), H("Configuration Issue", 0.38));
  assert.equal(r.value, "Configuration Issue");
  assert.equal(r.source, "ml");
});

test("resolvePick: no ML label falls through to heuristic", () => {
  const r = resolvePick(null, H("Configuration Issue", 0.38));
  assert.equal(r.value, "Configuration Issue");
  assert.equal(r.source, "heuristic");
});

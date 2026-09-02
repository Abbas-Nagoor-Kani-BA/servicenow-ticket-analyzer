import { test } from "node:test";
import assert from "node:assert/strict";

import { pickExact, resolvePick } from "../worker/ml-classify.ts";

const M = (value, confidence) => ({ value, confidence, source: "ml" });
const H = (value, confidence) => ({ value, confidence, source: "heuristic" });

test("pickExact: deterministic label is decisive over a low-confidence ML label", () => {
  const r = pickExact(M("Hardware", 0.08), H("Software", 0.9));
  assert.equal(r.value, "Software");
  assert.equal(r.source, "heuristic");
});

test("pickExact: deterministic wins an exact-confidence tie", () => {
  const r = pickExact(M("Hardware", 0.8), H("Software", 0.8));
  assert.equal(r.value, "Software");
  assert.equal(r.source, "heuristic");
});

test("pickExact: deterministic wins even when ML is far more confident", () => {
  const r = pickExact(M("Permanent solution", 0.99), H("Permanent solution", 0.76));
  assert.equal(r.value, "Permanent solution");
  assert.equal(r.source, "heuristic");
});

test("pickExact: deterministic clear win is stamped with its own source", () => {
  const r = pickExact(M("Hardware", 0.91), H("Software", 0.4));
  assert.equal(r.value, "Software");
  assert.equal(r.source, "heuristic");
});

test("pickExact: ML empty value -> deterministic", () => {
  const r = pickExact(M(null, 0.9), H("Software", 0.4));
  assert.equal(r.value, "Software");
  assert.equal(r.source, "heuristic");
});

test("pickExact: ML empty-string value -> deterministic", () => {
  const r = pickExact(M("", 0.9), H("Software", 0.4));
  assert.equal(r.value, "Software");
  assert.equal(r.source, "heuristic");
});

test("pickExact: ML fills the cell when deterministic produced nothing", () => {
  const r = pickExact(M("Hardware", 0.6), H(null, 0));
  assert.equal(r.value, "Hardware");
  assert.equal(r.source, "ml");
});

test("pickExact: both empty -> deterministic empty pick", () => {
  const r = pickExact(M(null, 0.5), H(null, 0));
  assert.equal(r.value, null);
  assert.equal(r.source, "heuristic");
});

test("resolvePick: deterministic label is kept even when ML has one", () => {
  const r = resolvePick(M("Configuration Issue", 0.08), H("Configuration Issue", 0.38));
  assert.equal(r.value, "Configuration Issue");
  assert.equal(r.source, "heuristic");
});

test("resolvePick: no ML label falls through to deterministic", () => {
  const r = resolvePick(null, H("Configuration Issue", 0.38));
  assert.equal(r.value, "Configuration Issue");
  assert.equal(r.source, "heuristic");
});

test("resolvePick: ML fills the cell when deterministic has no label", () => {
  const r = resolvePick(M("Hardware", 0.3), H(null, 0));
  assert.equal(r.value, "Hardware");
  assert.equal(r.source, "ml");
});

test("resolvePick: deterministic stage source is preserved (keyword)", () => {
  const r = resolvePick(M("Hardware", 0.9), H("Software", 0.5));
  assert.equal(r.source, "heuristic");
});
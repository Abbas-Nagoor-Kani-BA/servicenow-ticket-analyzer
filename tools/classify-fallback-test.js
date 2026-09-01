import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveApplyCell } from "../surfaces/viewer/classify.ts";

const W = (value = null, source = "ml", confidence = 0) => ({ value, source, confidence });

test("fallback: a weak heuristic cell is corrected by a confident ML pick", () => {
  const r = resolveApplyCell(W("Application bug", "ml", 1.0), { value: "Unknown", source: "heuristic", confidence: 0.3 }, true);
  assert.equal(r.value, "Application bug");
  assert.equal(r.source, "ml");
  assert.equal(r.confidence, 1.0);
});

test("fallback: a solid heuristic cell is kept when ML is not clearly better", () => {
  const r = resolveApplyCell(W("Hardware", "heuristic", 0.4), { value: "Network", source: "heuristic", confidence: 0.5 }, true);
  assert.equal(r.value, "Network");
  assert.equal(r.source, "heuristic");
  assert.equal(r.confidence, 0.5);
});

test("fallback: a manual edit is never overwritten", () => {
  const r = resolveApplyCell(W("Application bug", "ml", 0.9), { value: "Something else", source: undefined, confidence: undefined }, true);
  assert.equal(r.value, "Something else");
  assert.equal(r.source, "unrecorded");
});

test("fallback: an established ML result is not downgraded to heuristic", () => {
  const r = resolveApplyCell(W("Hardware", "heuristic", 0.4), { value: "Certificate expiry", source: "ml", confidence: 0.96 }, true);
  assert.equal(r.value, "Certificate expiry");
  assert.equal(r.source, "ml");
  assert.equal(r.confidence, 0.96);
});

test("fallback: a blank cell is filled by the worker pick", () => {
  const r = resolveApplyCell(W("Permanent solution", "ml", 0.76), { value: null, source: undefined, confidence: undefined }, true);
  assert.equal(r.value, "Permanent solution");
  assert.equal(r.source, "ml");
  assert.equal(r.confidence, 0.76);
});

test("always mode applies the worker pick regardless of current cell", () => {
  const r = resolveApplyCell(W("Application bug", "ml", 1.0), { value: "Old value", source: "heuristic", confidence: 0.4 }, false);
  assert.equal(r.value, "Application bug");
  assert.equal(r.source, "ml");
});

test("always mode keeps a heuristic pick when ML was not confident", () => {
  const r = resolveApplyCell(W("Hardware", "heuristic", 0.4), { value: null, source: undefined, confidence: undefined }, false);
  assert.equal(r.value, "Hardware");
  assert.equal(r.source, "heuristic");
});

test("always mode: a null worker result never erases an existing value", () => {
  const r = resolveApplyCell(W(null, "heuristic", 0), { value: "Previous value", source: "heuristic", confidence: 0.5 }, false);
  assert.equal(r.value, "Previous value");
  assert.equal(r.source, "heuristic");
  assert.equal(r.confidence, 0.5);
});

test("always mode: a null worker result keeps an established ML marker", () => {
  const r = resolveApplyCell(W(null, "heuristic", 0), { value: "Application bug", source: "ml", confidence: 0.96 }, false);
  assert.equal(r.value, "Application bug");
  assert.equal(r.source, "ml");
  assert.equal(r.confidence, 0.96);
});

test("fallback mode: a null worker result never erases an existing value", () => {
  const r = resolveApplyCell(W(null, "heuristic", 0), { value: "Network", source: "heuristic", confidence: 0.5 }, true);
  assert.equal(r.value, "Network");
  assert.equal(r.source, "heuristic");
  assert.equal(r.confidence, 0.5);
});

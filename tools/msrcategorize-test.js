import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyMsr } from "../core/msrcategorize.ts";
import { MSR_DEFAULT_LISTS, rootCauseFor, msrType } from "../core/msrchoices.ts";

const INCIDENT_RC = rootCauseFor(MSR_DEFAULT_LISTS.rootCause, msrType("INC001"));
const RESOLUTION = MSR_DEFAULT_LISTS.resolution;

function assertLabel(text, labels, expected, minConfidence = 0.35) {
  const r = classifyMsr(text, labels, { minConfidence });
  assert.equal(r.label, expected, `expected "${expected}" for: ${text}`);
  assert.ok(r.confidence >= 0, "confidence is a number");
  return r;
}

test("classifyMsr maps a hardware root cause", () => {
  const text = "Root cause was a faulty disk — drive replaced, no other issues.";
  const r = assertLabel(text, INCIDENT_RC, "Hardware");
  assert.ok(r.confidence >= 0.35);
});

test("classifyMsr maps a network issue", () => {
  const text = "Packet loss between router and DC caused persistent connectivity loss.";
  assertLabel(text, INCIDENT_RC, "Network issue");
});

test("classifyMsr maps a certificate expiry", () => {
  const text = "The SSL certificate expired on the load balancer.",
    r = classifyMsr(text, INCIDENT_RC, { minConfidence: 0.3 });
  assert.equal(r.label, "Certificate expiry");
});

test("classifyMsr maps an application bug", () => {
  const text = "Identified a code defect in the module — applied a patch.";
  assertLabel(text, INCIDENT_RC, "Application bug");
});

test("classifyMsr maps user error - procedure", () => {
  const text = "User followed the wrong business process step.";
  assertLabel(text, INCIDENT_RC, "User error - procedure");
});

test("classifyMsr maps environment when infrastructure was the cause", () => {
  const text = "Datacenter cooling failed causing the whole environment to degrade.";
  assertLabel(text, INCIDENT_RC, "Environment");
});

test("classifyMsr returns null with no evidence", () => {
  const r = classifyMsr("appears fine", INCIDENT_RC);
  assert.equal(r.label, null);
  assert.equal(r.confidence, 0);
});

test("classifyMsr returns null on a weak tie", () => {
  const r = classifyMsr("slightly slow", INCIDENT_RC);
  assert.equal(r.label, null);
});

test("classifyMsr detects solution type - workaround", () => {
  assertLabel("Applied a temporary workaround until the vendor ships the patch.", RESOLUTION, "Workaround solution");
});

test("classifyMsr detects solution type - permanent", () => {
  assertLabel("Deployed the permanent code change to production.", RESOLUTION, "Permanent solution");
});

test("classifyMsr detects solution type - verification only", () => {
  assertLabel("Verified in test environment, confirmed working.", RESOLUTION, "Verification only", 0.3);
});

test("classifyMsr maps phrase not just single tokens", () => {
  const r = classifyMsr("user error - procedure", INCIDENT_RC);
  assert.equal(r.label, "User error - procedure");
});

test("classifyMsr respects learned hint overrides", () => {
  const r = classifyMsr("reseeded the DB cache", INCIDENT_RC, {
    hints: { "database performance": ["reseeded"] }
  });
  assert.equal(r.label, "Database performance");
});

test("classifyMsr scores are per-label and deterministic", () => {
  const a = classifyMsr("network latency issue", INCIDENT_RC);
  const b = classifyMsr("network latency issue", INCIDENT_RC);
  assert.deepEqual(a, b);
  assert.ok((a.scores["Network issue"] || 0) > 0);
});

test("classifyMsr works against a P_Ticket root cause list", () => {
  const PTASK_RC = rootCauseFor(MSR_DEFAULT_LISTS.rootCause, msrType("PTASK001"));
  const r = classifyMsr("Incorrect data entered by the user into the file.", PTASK_RC, { minConfidence: 0.3 });
  assert.equal(r.label, "User error - data");
});

test("classifyMsr returns the exact MSR label value", () => {
  assert.equal(classifyMsr("not an issue", INCIDENT_RC).label, "Not an issue");
  assert.equal(classifyMsr("no issue", INCIDENT_RC).label, "Not an issue");
  assert.equal(classifyMsr("network issue", INCIDENT_RC).label, "Network issue");
});

test("cosine similarity boosts confidence on a genuine match", () => {
  const note = "certificate hit its expiry window on the gateway";
  const keywordOnly = classifyMsr(note, INCIDENT_RC, { cosineWeight: 0 });
  const blended = classifyMsr(note, INCIDENT_RC);
  assert.equal(blended.label, "Certificate expiry");
  assert.ok(blended.confidence > keywordOnly.confidence, "blending cosine raises confidence over keyword counting");
});

test("cosine does not over-fire on generic vocabulary", () => {
  assert.equal(classifyMsr("there was an issue", INCIDENT_RC).label, null);
  assert.equal(classifyMsr("appears fine", INCIDENT_RC).label, null);
});

test("blended scorer is deterministic", () => {
  const a = classifyMsr("the interface returned a mapping error", INCIDENT_RC);
  const b = classifyMsr("the interface returned a mapping error", INCIDENT_RC);
  assert.deepEqual(a, b);
});

test("learned hint overrides still feed the cosine vector", () => {
  const r = classifyMsr("reseeded the DB cache", INCIDENT_RC, {
    hints: { "database performance": ["reseeded"] }
  });
  assert.equal(r.label, "Database performance");
});

test("cascade uses the regex stage first (exact phrasing wins)", () => {
  const r = classifyMsr("User error: the operator entered wrong data", INCIDENT_RC, { minConfidence: 0.3 });
  assert.equal(r.label, "User error - procedure", "regex 'user error' wins before keyword/cosine");
  assert.equal(r.level, "regex");
});

test("cascade uses the keyword stage when hint hits clear the bar", () => {
  const r = classifyMsr("reseeded and reindexed the DB cache", INCIDENT_RC, {
    hints: { "database performance": ["reseeded", "reindexed"] },
    useRegex: false,
    minConfidence: 0.3
  });
  assert.equal(r.label, "Database performance");
  assert.equal(r.level, "keyword", "two hint hits using no regex pick the keyword stage");
});

test("cascade falls to cosine for a paraphrase with no exact phrase", () => {
  const r = classifyMsr("interface data mismatch on the payload", INCIDENT_RC, {
    hints: { "interface data error": [] },
    useRegex: false,
    minConfidence: 0.3
  });
  assert.equal(r.label, "Interface data error");
  assert.equal(r.level, "cosine", "no hints -> the cosine stage decides");
});

test("cascade returns null when no stage clears its bar", () => {
  const r = classifyMsr("appears fine", INCIDENT_RC);
  assert.equal(r.label, null);
  assert.equal(r.level, null);
});


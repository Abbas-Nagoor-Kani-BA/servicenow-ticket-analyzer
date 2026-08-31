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

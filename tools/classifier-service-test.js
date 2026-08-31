import { test } from "node:test";
import assert from "node:assert/strict";

import { ClassifierService, deterministicClassify } from "../services/classifier-service.ts";
import { MSR_DEFAULT_LISTS, mergeMsrLists } from "../core/msrchoices.ts";
import { createMemoryClassificationCacheRepository } from "../data/classification-cache-repository.ts";

const LISTS = mergeMsrLists(null);

function row(number, closeNotes, extra = {}) {
  return { number, closeNotes, ...extra };
}

test("deterministicClassify maps notes to the per-type MSR lists", () => {
  const out = deterministicClassify({
    notes: "Packet loss in the network caused an outage.",
    rootCauseLabels: MSR_DEFAULT_LISTS.rootCause.Incident,
    resolutionLabels: MSR_DEFAULT_LISTS.resolution
  });
  assert.equal(out.rootCause.value, "Network issue");
  assert.equal(out.solutionType.value, null);
});

test("buildInputs skips rows without notes but keeps the right lists", () => {
  const svc = new ClassifierService();
  const inputs = svc.buildInputs(
    [
      row("INC001", "disk failure on the server"),
      row("INC002", ""),
      row("PTASK001", "wrong data entered by user")
    ],
    LISTS
  );
  assert.equal(inputs.length, 2);
  assert.ok(inputs[0].rootCauseLabels.includes("Hardware"));
  const ptask = inputs.find((i) => i.row.number === "PTASK001");
  assert.ok(ptask);
  assert.ok(ptask.rootCauseLabels.includes("User error - data"));
  assert.ok(!ptask.rootCauseLabels.includes("User error - procedure"));
});

test("run fills only blank fields in fallback mode", async () => {
  const svc = new ClassifierService();
  const rows = [
    row("INC001", "disk failure on the server"),
    row("INC002", "dns resolution issue", { solutionType: "Permanent solution", rootCause: "Network issue" })
  ];
  const stats = await svc.run(rows, LISTS, "fallback", (r, _i, out) => {
    if (!r.rootCause) r.rootCause = out.rootCause.value;
    if (!r.solutionType) r.solutionType = out.solutionType.value;
  });
  assert.equal(rows[0].rootCause, "Hardware");
  assert.equal(rows[1].rootCause, "Network issue");
  assert.equal(rows[1].solutionType, "Permanent solution");
  assert.equal(stats.classifiedRootCause, 1);
});

test("run re-classifies every row in always mode", async () => {
  const svc = new ClassifierService();
  const rows = [row("INC001", "certificate expired", { rootCause: "Old value", solutionType: "Old" })];
  const stats = await svc.run(rows, LISTS, "always", (r, _i, out) => {
    r.rootCause = out.rootCause.value;
    r.solutionType = out.solutionType.value;
  });
  assert.equal(rows[0].rootCause, "Certificate expiry");
  assert.ok(stats.classifiedRootCause >= 1);
});

test("run reports progress in batches and completes", async () => {
  let lastDone = 0;
  const calls = [];
  const svc = new ClassifierService({ batchSize: 2, onProgress: (d, t) => { lastDone = d; calls.push([d, t]); } });
  const rows = Array.from({ length: 5 }, (_, i) =>
    row(`INC${String(i + 1).padStart(3, "0")}`, "application bug caused a crash")
  );
  const stats = await svc.run(rows, LISTS, "always", (r, _i, out) => {
    r.rootCause = out.rootCause.value;
  });
  assert.equal(lastDone, 5);
  assert.ok(calls.length >= 2);
  assert.ok(stats.classifiedRootCause >= 5);
});

test("run flags low-confidence results for review", async () => {
  const fakeClassify = () => ({
    solutionType: { value: null, confidence: 0 },
    rootCause: { value: "Hardware", confidence: 0.21 }
  });
  const svc = new ClassifierService({ classify: fakeClassify });
  const rows = [row("INC001", "something vague")];
  const stats = await svc.run(rows, LISTS, "always", (r, _i, out) => {
    r.rootCause = out.rootCause.value;
  });
  assert.equal(stats.lowConfidence, 1);
});

test("run reports zero with no notes", async () => {
  const svc = new ClassifierService();
  const stats = await svc.run([row("INC001", "")], LISTS, "always", () => {});
  assert.equal(stats.withNotes, 0);
  assert.equal(stats.classifiedRootCause, 0);
});

test("cached classify reuses the result and calls compute once", async () => {
  let calls = 0;
  const fakeClassify = (input) => {
    calls++;
    const label = String(input.notes).includes("disk") ? "Hardware" : null;
    return {
      solutionType: { value: null, confidence: 0 },
      rootCause: { value: label, confidence: 0.6 }
    };
  };
  const svc = new ClassifierService({ classify: fakeClassify, cache: createMemoryClassificationCacheRepository() });
  const rows = [row("INC001", "disk failure on the server")];
  const commit = (r, _i, out) => { r.rootCause = out.rootCause.value; };

  await svc.run(rows, LISTS, "always", commit);
  await svc.run(rows, LISTS, "always", commit);
  assert.equal(calls, 1, "compute ran once; second run served from cache");
  assert.equal(rows[0].rootCause, "Hardware");
});

test("cache can be disabled (cacheEnabled false)", async () => {
  let calls = 0;
  const fakeClassify = (input) => {
    calls++;
    const label = String(input.notes).includes("disk") ? "Hardware" : null;
    return {
      solutionType: { value: null, confidence: 0 },
      rootCause: { value: label, confidence: 0.6 }
    };
  };
  const svc = new ClassifierService({ classify: fakeClassify, cacheEnabled: false });
  const rows = [row("INC001", "disk failure on the server")];
  const commit = (r, _i, out) => { r.rootCause = out.rootCause.value; };

  await svc.run(rows, LISTS, "always", commit);
  await svc.run(rows, LISTS, "always", commit);
  assert.equal(calls, 2, "cache disabled -> compute ran every time");
});

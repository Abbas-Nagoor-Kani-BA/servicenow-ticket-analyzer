import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryClassificationCacheRepository, hashKey } from "../data/classification-cache-repository.ts";

function input(over = {}) {
  return {
    notes: "Restarted the server, everything is working fine now.",
    rootCauseLabels: ["Hardware", "Network issue", "Not an issue"],
    resolutionLabels: ["Workaround solution", "Permanent solution"],
    modelId: "mobilebert",
    ...over
  };
}

function entry(over = {}) {
  return {
    outcome: {
      solutionType: { value: "Workaround solution", confidence: 0.5 },
      rootCause: { value: "Not an issue", confidence: 0.4 }
    },
    savedAt: Date.now(),
    hits: 0,
    ...over
  };
}

test("hashKey is stable and distinguishes notes, labels and model", () => {
  const a = input();
  assert.equal(hashKey(a), hashKey(input()));
  assert.notEqual(hashKey(a), hashKey(input({ notes: "different note" })));
  assert.notEqual(hashKey(a), hashKey(input({ rootCauseLabels: ["Hardware"] })));
  assert.notEqual(hashKey(a), hashKey(input({ modelId: "distilbert" })));
});

test("get returns undefined for an unseen key and the stored entry after put", async () => {
  const repo = createMemoryClassificationCacheRepository();
  assert.equal(await repo.get(input()), undefined);
  await repo.put(input(), entry());
  const got = await repo.get(input());
  assert.ok(got);
  assert.equal(got.outcome.rootCause.value, "Not an issue");
  assert.equal((await repo.stats()).entries, 1);
});

test("noteHit bumps hits without changing the outcome", async () => {
  const repo = createMemoryClassificationCacheRepository();
  await repo.put(input(), entry());
  await repo.noteHit(input());
  const got = await repo.get(input());
  assert.equal(got.hits, 1);
  assert.equal(got.outcome.solutionType.value, "Workaround solution");
});

test("clear empties the store and resets the counter", async () => {
  const repo = createMemoryClassificationCacheRepository();
  await repo.put(input(), entry());
  assert.equal((await repo.stats()).entries, 1);
  await repo.clear();
  assert.equal((await repo.stats()).entries, 0);
  assert.equal(await repo.get(input()), undefined);
});

test("same notes but different root-cause label list is a separate entry", async () => {
  const repo = createMemoryClassificationCacheRepository();
  await repo.put(input(), entry());
  await repo.put(input({ rootCauseLabels: ["User error - data"] }), entry({ outcome: {
    solutionType: { value: null, confidence: 0 },
    rootCause: { value: "User error - data", confidence: 0.6 }
  } }));
  assert.equal((await repo.stats()).entries, 2);
  const incident = await repo.get(input());
  const ptask = await repo.get(input({ rootCauseLabels: ["User error - data"] }));
  assert.equal(incident.outcome.rootCause.value, "Not an issue");
  assert.equal(ptask.outcome.rootCause.value, "User error - data");
});

test("distinct models get distinct entries", async () => {
  const repo = createMemoryClassificationCacheRepository();
  await repo.put(input(), entry());
  await repo.put(input({ modelId: "distilbert" }), entry({ outcome: {
    solutionType: { value: "Permanent solution", confidence: 0.7 },
    rootCause: { value: "Hardware", confidence: 0.6 }
  } }));
  assert.equal((await repo.stats()).entries, 2);
  assert.equal((await repo.get(input({ modelId: "distilbert" }))).outcome.rootCause.value, "Hardware");
});

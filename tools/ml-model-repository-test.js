import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryMlModelRepository, ML_MODEL_CATALOG, modelById, modelByRepoId, specForModelId, CLASSIFIER_MODEL } from "../data/ml-model-repository.ts";

function bytesOf(s) {
  return new TextEncoder().encode(s).buffer;
}

function withFetch(files) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    for (const [path, body] of Object.entries(files)) {
      if (url.endsWith(`/${encodeURIComponent(path)}`)) {
        return { ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytesOf(body)) };
      }
    }
    return { ok: false, status: 404, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) };
  };
  return () => {
    globalThis.fetch = original;
  };
}

test("isReady is false when nothing is cached", async () => {
  const repo = createMemoryMlModelRepository();
  assert.equal(await repo.isReady(), false);
  assert.equal(await repo.getMeta(), null);
});

test("download caches files and reports progress", async () => {
  const restore = withFetch({ "config.json": "{}", "onnx/model.onnx": "MODELBYTES" });
  try {
    const repo = createMemoryMlModelRepository();
    const progress = [];
    const meta = await repo.download(
      { repoId: "Xenova/x", files: ["config.json", "onnx/model.onnx"] },
      (p) => progress.push(p)
    );
    assert.equal(meta.repoId, "Xenova/x");
    assert.ok(progress.length >= 2);
    // final callback reports both files done
    const last = progress[progress.length - 1];
    assert.equal(last.done, 2);
    assert.equal(last.total, 2);
    assert.equal(await repo.isReady(), true);

    const config = await repo.getFile({ repoId: "Xenova/x", files: ["config.json", "onnx/model.onnx"] }, "config.json");
    assert.ok(config);
    assert.equal(new TextDecoder().decode(new Uint8Array(config)), "{}");
  } finally {
    restore();
  }
});

test("a failed file leaves isReady() false and no meta", async () => {
  const restore = withFetch({ "config.json": "{}" });
  try {
    const repo = createMemoryMlModelRepository();
    await assert.rejects(
      repo.download({ repoId: "Xenova/x", files: ["config.json", "missing.onnx"] }),
      /Download failed/
    );
    assert.equal(await repo.isReady(), false);
    assert.equal(await repo.getMeta(), null);
  } finally {
    restore();
  }
});

test("clear removes the model", async () => {
  const restore = withFetch({ "config.json": "{}", "model.onnx": "BYTES" });
  try {
    const repo = createMemoryMlModelRepository();
    await repo.download({ repoId: "Xenova/x", files: ["config.json", "model.onnx"] });
    assert.equal(await repo.isReady(), true);
    await repo.clear();
    assert.equal(await repo.isReady(), false);
  } finally {
    restore();
  }
});

test("an empty file list is never ready", async () => {
  const repo = createMemoryMlModelRepository();
  assert.equal(await repo.isReady(), false);
});

test("matches is false until the exact model spec is cached", async () => {
  const restore = withFetch({ "config.json": "{}", "model.onnx": "BYTES" });
  try {
    const repo = createMemoryMlModelRepository();
    const spec = { repoId: "Xenova/x", files: ["config.json", "model.onnx"] };
    assert.equal(await repo.matches(spec), false);

    await repo.download(spec);
    assert.equal(await repo.matches(spec), true);
    // A different repoId must not match even with files present.
    assert.equal(await repo.matches({ repoId: "Other/y", files: spec.files }), false);
    // A request for a file this repo never had must not match.
    assert.equal(await repo.matches({ repoId: "Xenova/x", files: ["config.json", "missing.onnx"] }), false);
  } finally {
    restore();
  }
});

test("downloading a different model keeps the previously cached one", async () => {
  const restore = withFetch({ "config.json": "{}", "model.onnx": "OLD", "new.onnx": "NEW" });
  try {
    const repo = createMemoryMlModelRepository();
    const old = { repoId: "Old/repo", files: ["config.json", "model.onnx"] };
    await repo.download(old);
    assert.equal(await repo.matches(old), true);

    const next = { repoId: "New/repo", files: ["config.json", "new.onnx"] };
    await repo.download(next);
    assert.equal(await repo.matches(next), true);
    // The old model's files are preserved (keyed per repoId), so it still
    // "matches" — only the active meta points at the newest download.
    assert.equal(await repo.matches(old), true);
    const oldModel = await repo.getFile(old, "model.onnx");
    assert.equal(new TextDecoder().decode(new Uint8Array(oldModel)), "OLD");
  } finally {
    restore();
  }
});

test("matches reflects each model's own cache independent of meta", async () => {
  const restore = withFetch({ "config.json": "{}", "model.onnx": "BYTES" });
  try {
    const repo = createMemoryMlModelRepository();
    const spec = { repoId: "Xenova/x", files: ["config.json", "model.onnx"] };
    assert.equal(await repo.matches(spec), false);
    await repo.download(spec);
    assert.equal(await repo.matches(spec), true);
    // A different repoId must not match even though a model was cached.
    assert.equal(await repo.matches({ repoId: "Other/y", files: spec.files }), false);
    // A request for a file this repo never had must not match.
    assert.equal(await repo.matches({ repoId: "Xenova/x", files: ["config.json", "missing.onnx"] }), false);
  } finally {
    restore();
  }
});

test("the model catalog exposes selectable zero-shot models with specs", () => {
  assert.ok(ML_MODEL_CATALOG.length >= 2, "catalog offers more than one model");
  for (const opt of ML_MODEL_CATALOG) {
    assert.ok(opt.id, "option has an id");
    assert.ok(opt.label, "option has a label");
    assert.ok(opt.spec.repoId, "option has a repoId");
    assert.ok(opt.spec.files.length, "option has files");
  }
  // First option is the default shipped model.
  assert.equal(ML_MODEL_CATALOG[0].spec.repoId, "Xenova/mobilebert-uncased-mnli");
});

test("two catalog models are distinct (must not share a cache spec)", () => {
  const a = ML_MODEL_CATALOG[0].spec;
  const b = ML_MODEL_CATALOG[1].spec;
  assert.notEqual(a.repoId, b.repoId, "distinct repoIds so downloading one does not clobber the other");
});

test("modelById / modelByRepoId resolve catalog entries", () => {
  const opt = modelById("distilbert");
  assert.ok(opt);
  assert.equal(opt.id, "distilbert");
  assert.equal(modelById("missing"), null);
  assert.equal(modelById(null), null);

  const byRepo = modelByRepoId(opt.spec.repoId);
  assert.ok(byRepo);
  assert.equal(byRepo.id, "distilbert");
  assert.equal(modelByRepoId("nope/x"), null);
});

test("specForModelId falls back to the default model for unknown/blank ids", () => {
  assert.equal(specForModelId("mobilebert").repoId, CLASSIFIER_MODEL.repoId);
  assert.equal(specForModelId("distilbert").repoId, "Xenova/distilbert-base-uncased-mnli");
  assert.equal(specForModelId("nope").repoId, CLASSIFIER_MODEL.repoId);
  assert.equal(specForModelId(null).repoId, CLASSIFIER_MODEL.repoId);
  assert.equal(specForModelId("").repoId, CLASSIFIER_MODEL.repoId);
});

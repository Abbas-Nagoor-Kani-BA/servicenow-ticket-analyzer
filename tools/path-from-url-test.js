import { test } from "node:test";
import assert from "node:assert/strict";

import { pathFromUrl } from "../worker/ml-classify.ts";

const FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"];

test("pathFromUrl strips remote resolve URLs to the bare file path", () => {
  assert.equal(
    pathFromUrl("https://huggingface.co/Xenova/mobilebert-uncased-mnli/resolve/main/onnx/model_quantized.onnx", FILES),
    "onnx/model_quantized.onnx"
  );
  assert.equal(
    pathFromUrl("https://huggingface.co/Xenova/mobilebert-uncased-mnli/resolve/main/config.json", FILES),
    "config.json"
  );
});

test("pathFromUrl strips local /models/ paths and bare repo paths", () => {
  assert.equal(pathFromUrl("/models/Xenova/mobilebert-uncased-mnli/onnx/model_quantized.onnx", FILES), "onnx/model_quantized.onnx");
  assert.equal(pathFromUrl("Xenova/mobilebert-uncased-mnli/onnx/model_quantized.onnx", FILES), "onnx/model_quantized.onnx");
  assert.equal(pathFromUrl("./Xenova/mobilebert-uncased-mnli/tokenizer.json", FILES), "tokenizer.json");
});

test("pathFromUrl ignores query strings and returns null for unknown files", () => {
  assert.equal(
    pathFromUrl("https://huggingface.co/Xenova/mobilebert-uncased-mnli/resolve/main/config.json?download=true", FILES),
    "config.json"
  );
  assert.equal(pathFromUrl("https://huggingface.co/Xenova/mobilebert-uncased-mnli/resolve/main/random.bin", FILES), null);
});

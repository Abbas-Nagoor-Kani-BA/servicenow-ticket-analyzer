import type { ClassifyRowInput, ClassifyCell } from "../services/classifier-service.ts";
import { deterministicClassify } from "../services/classifier-service.ts";
import { MlModelStore, specForModelId } from "../data/ml-model-repository.ts";
import type { MlModelSpec } from "../data/ml-model-repository.ts";
import { STORAGE } from "../lib/keys.ts";

// Common English function words. Deliberately excludes negation/qualifier words
// that carry meaning in the MSR labels ("not", "no", "never", "only", "but",
// "user", "error", "access", "issue"), so stripping can never flip things like
// "not an issue" into its opposite.
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "was", "were", "is", "are", "am", "be",
  "been", "being", "has", "have", "had", "do", "does", "did", "will", "would",
  "shall", "should", "can", "could", "may", "might", "must", "of", "to", "in",
  "on", "at", "by", "for", "with", "about", "against", "between", "into",
  "through", "during", "before", "after", "above", "below", "from", "again",
  "further", "once", "here", "there", "when", "where", "why", "how", "all",
  "any", "both", "each", "few", "more", "most", "other", "some", "such", "own",
  "same", "so", "than", "too", "very", "it", "this", "that", "these", "those",
  "we", "they", "he", "she", "him", "her", "us", "them", "you", "your", "ours",
  "theirs", "my", "our", "its", "as", "per", "via", "within", "along", "among",
  "onto", "upon", "regarding", "like", "just", "then", "whose"
]);

// Direction/state words ("down", "up", "out", "off", "over", "under") are
// intentionally NOT stopwords: they carry meaning in IT notes ("service down",
// "timed out").

/** Lowercases and removes common function words so the model spends its 512
 *  token budget on content words (leaving room for the candidate label). */
function stripCommonWords(note: string): string {
  const out: string[] = [];
  for (const raw of String(note).toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || raw.length === 1) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push(raw);
  }
  return out.join(" ");
}

/** A per-cell pick additionally carrying which engine produced it (for Calclens). */
export type EnginePick = {
  value: string | null;
  confidence: number;
  source: "ml" | "heuristic";
};

/** Reads the selected model id from the persisted settings. */
async function selectedModelId(): Promise<string> {
  try {
    const st = await chrome.storage.local.get(STORAGE.pluginSettings);
    const ml = (st?.[STORAGE.pluginSettings] as any)?.ml;
    return typeof ml?.modelId === "string" ? ml.modelId : "mobilebert";
  } catch {
    return "mobilebert";
  }
}

/*
 * Optional Transformers.js classification backend.
 *
 * Second stage of the hybrid: the deterministic scorer always runs; this module
 * is loaded lazily by the worker only when the user picks the ML or Hybrid
 * classification mode. It
 * serves the cached model bytes (own IndexedDB database, never the pull cache)
 * to Transformers.js through its custom-cache hook, so inference is fully
 * offline after the one-time Settings download.
 *
 * Everything is defensive: a missing model, a missing file, or a runtime failure
 * resolves to null, and the caller falls back to the deterministic scorer. The
 * classify fn returns an async result (the worker awaits it), and when the ML
 * score does not beat the deterministic one the deterministic value wins.
 */

function pathFromUrl(url: string, files: string[]): string | null {
  // Cache-request shapes (remote URL, /models/ local path, or bare repo path)
  // always end with one of the model's known file paths. Match the suffix
  // against the file set — unambiguous, and immune to the leading origin,
  // <repoId>/resolve/<rev>/ or /models/<repoId>/ prefixes.
  const clean = String(url || "").split(/[?#]/)[0];
  for (const file of files) {
    if (clean.endsWith(`/${file}`) || clean.endsWith(file)) return file;
  }
  return null;
}

function bytesResponse(bytes: ArrayBuffer, contentType: string): Response {
  return new Response(bytes, { status: 200, statusText: "OK", headers: { "content-type": contentType } });
}

/** Builds a Cache-API-compatible cache backed by the model repository. */
function makeRepoCache(repo: MlModelStore, spec: MlModelSpec) {
  return {
    async match(request: string): Promise<Response | undefined> {
      const path = pathFromUrl(request, spec.files);
      if (!path) return undefined;
      const bytes = await repo.getFile(spec, path);
      if (!bytes) return undefined;
      const ct = path.endsWith(".json") ? "application/json" : "application/octet-stream";
      return bytesResponse(bytes, ct);
    },
    async put(): Promise<void> {
      /* read-only: the model is managed by the repository */
    },
    async delete(_key: string): Promise<boolean> {
      return false;
    }
  };
}

type MlClassifier = {
  (notes: string, labels: string[]): Promise<{ label: string | null; confidence: number }>;
};

async function loadMlClassifier(): Promise<MlClassifier | null> {
  const repo = new MlModelStore();
  // Use the model selected in Settings (ml.modelId), not just whichever was
  // downloaded last. A stale or half-downloaded model must not load.
  const selectedId = await selectedModelId();
  const spec = specForModelId(selectedId);
  if (!(await repo.matches(spec))) {
    console.warn(
      "[classifier] selected ML model not downloaded — run Settings → ML classification → Download model."
    );
    return null;
  }

  const { pipeline, env } = await import("@huggingface/transformers");

  // The model is served from a custom cache, so local models are "enabled"
  // (allowLocalModels governs the cache path); remote fetching stays off so the
  // worker never phones out to the Hub. In a Worker there is no filesystem, so
  // Transformers.js defaults allowLocalModels to false — we must set it true or
  // it rejects the config as "both local and remote disabled".
  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.allowRemoteUrls = false;

  // Transformers.js caches the wasm factory to a Blob and imports it. MV3's
  // `script-src 'self'` blocks `blob:` scripts. Disable the wasm cache and the
  // browser cache so the factory is imported from the packaged same-origin .mjs
  // (allowed) rather than wrapped in a Blob (blocked).
  env.useWasmCache = false;
  env.useBrowserCache = false;

  // The worker has no `chrome.runtime`; derive the model/wasm URL from the
  // worker script's own location so the packaged wasm assets resolve to the
  // extension origin. The worker script lives at /worker/classifier-worker.js,
  // so "ml-wasm" resolves to /worker/ml-wasm (NOT "worker/ml-wasm", which would
  // double the segment). CPU inference uses the "asyncify" wasm factory (not
  // the WebGPU-only .jsep variant).
  const base = new URL("ml-wasm", self.location.href).toString();
  const wasmPaths = {
    wasm: `${base}/ort-wasm-simd-threaded.asyncify.wasm`,
    mjs: `${base}/ort-wasm-simd-threaded.asyncify.mjs`
  };
  const onnxEnv = (env as any).backends?.onnx;
  if (onnxEnv?.wasm) (onnxEnv.wasm as any).wasmPaths = wasmPaths;

  env.useCustomCache = true;
  (env as any).customCache = makeRepoCache(repo, spec);

  // Pipeline options: default dtype q8 selects "model_quantized.onnx" via the
  // dtype suffix mapping, so we must NOT pass model_file_name (it would be
  // concatenated again as "..._quantized.onnx_quantized.onnx"). The model files
  // are served from the custom cache.
  const classifier = await pipeline("zero-shot-classification", spec.repoId, {
    local_files_only: true,
    device: "wasm",
    // Single thread: the MV3 worker is not cross-origin-isolated, so
    // SharedArrayBuffer-backed multithreading would fail to initialise.
    session_options: { executionProviders: ["wasm"], numThreads: 1 }
  });

  // The zero-shot pipeline tokenizes with { padding, truncation } but never sets
  // max_length, and the tokenizer's model_max_length defaults to Infinity when
  // the tokenizer config omits it. A long work-note is therefore padded to the
  // batch max and fed to the ONNX model past its supported sequence length,
  // which throws "Attempting to broadcast an axis by a dimension other than 1".
  // Pin the tokenizer to the model's own maximum so the note is truncated.
  const maxLen = Number((classifier as any).model?.config?.max_position_embeddings) || 512;
  try {
    const tok = (classifier as any).tokenizer;
    if (tok && tok._tokenizerConfig) tok._tokenizerConfig.model_max_length = maxLen;
  } catch {
    /* best-effort; the per-call try/catch below still degrades gracefully */
  }

  return async (notes: string, labels: string[]) => {
    try {
      if (!notes.trim() || !labels.length) return { label: null, confidence: 0 };
      const cleaned = stripCommonWords(notes);
      if (!cleaned) return { label: null, confidence: 0 };
      const res = await classifier(cleaned, labels);
      const label = res?.labels?.[0];
      const score = Number(res?.scores?.[0] ?? 0);
      if (!label || !Number.isFinite(score)) return { label: null, confidence: 0 };
      return { label, confidence: Math.round(score * 100) / 100 };
    } catch (err) {
      console.warn("[classifier] zero-shot failed", err);
      return { label: null, confidence: 0 };
    }
  };
}

/** Raw per-engine picks for one cell (both engines, pre-decision). Cached so the
 *  verdict can be re-derived under whatever `pickExact` rule is current. */
export type CellPicks = { ml: EnginePick | null; det: EnginePick };

/** Combines the ML and deterministic picks for a cell into the decisive pick. */
export function resolvePick(ml: EnginePick | null, det: EnginePick): EnginePick {
  return ml && ml.value ? pickExact(ml, det) : { ...det, source: "heuristic" };
}

async function classifyWithMl(
  ml: MlClassifier,
  input: ClassifyRowInput
): Promise<{ solutionType: CellPicks; rootCause: CellPicks }> {
  const det = deterministicClassify(input);
  const detSame = (c: ClassifyCell): EnginePick => ({ value: c.value, confidence: c.confidence, source: "heuristic" });
  const [rc, st] = await Promise.all([
    ml(input.notes, input.rootCauseLabels),
    ml(input.notes, input.resolutionLabels)
  ]);
  return {
    rootCause: {
      ml: { value: rc.label, confidence: rc.confidence, source: "ml" },
      det: detSame(det.rootCause)
    },
    solutionType: {
      ml: { value: st.label, confidence: st.confidence, source: "ml" },
      det: detSame(det.solutionType)
    }
  };
}

/**
 * Selects the winning engine for one cell.
 *
 * Decided by provenance, not by a confidence race: ML is authoritative whenever
 * it produced a non-null label — the source is stamped "ml" so every cell the
 * ML model classified shows as Source: ML. Only when ML returned no label at
 * all does the deterministic (keyword) result fill the cell (source
 * "heuristic"). This is what makes the ML source actually visible; the keyword
 * scorer never overrides an ML label.
 *
 * `floor`/`margin` are retained only for back-compat callers that still pass
 * them; they no longer gate the decision (a floor of 0 means "any ML label
 * wins").
 */
export function pickExact(
  ml: EnginePick,
  det: EnginePick,
  _o: { floor?: number; margin?: number } = {}
): EnginePick {
  if (ml.value !== null && ml.value !== undefined && ml.value !== "") {
    return { value: ml.value, confidence: ml.confidence, source: "ml" };
  }
  return { value: det.value, confidence: det.confidence, source: "heuristic" };
}

/**
 * Builds a raw-picks classifier, or null when the model/runtime cannot be used.
 * The caller (the worker) falls back to the deterministic scorer on null. The
 * picks are cached per note/model; the caller derives the final verdict from
 * them with `resolveOutcome`, so a changed decision rule never serves a stale
 * verdict from the cache.
 */
export async function createMlPicker(): Promise<
  ((input: ClassifyRowInput) => Promise<{ solutionType: CellPicks; rootCause: CellPicks }>) | null
> {
  try {
    const ml = await loadMlClassifier();
    if (!ml) return null;
    return (input: ClassifyRowInput) => classifyWithMl(ml, input);
  } catch (err) {
    console.warn("[classifier] ML setup failed; falling back to deterministic", err);
    return null;
  }
}

/** Turns raw per-cell picks into the final verdict outcome (one source per cell). */
export function resolveOutcome(p: { solutionType: CellPicks; rootCause: CellPicks }): {
  solutionType: EnginePick;
  rootCause: EnginePick;
} {
  return {
    rootCause: resolvePick(p.rootCause.ml, p.rootCause.det),
    solutionType: resolvePick(p.solutionType.ml, p.solutionType.det)
  };
}

export { pathFromUrl, stripCommonWords, STOPWORDS };

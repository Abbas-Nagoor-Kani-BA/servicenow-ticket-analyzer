import { deterministicClassify } from "../services/classifier-service.ts";
import type { ClassifyMode, ClassifyRowInput, ClassifyCell } from "../services/classifier-service.ts";
import { resolveOutcome } from "./ml-classify.ts";
import type { CellPicks, EnginePick } from "./ml-classify.ts";
import { ClassificationCacheStore } from "../data/classification-cache-repository.ts";
import type { ClassifyCacheEntry, CacheKeyInput } from "../data/classification-cache-repository.ts";

/*
 * Viewer-side classification worker.
 *
 * Runs as a module Web Worker (packaged file, not a Blob, so it satisfies MV3
 * `script-src 'self'`). It keeps classification off the UI thread: the viewer
 * posts rows, the worker classifies them, and posts results back in chunks so
 * the grid can render incrementally without freezing.
 *
 * The deterministic scorer is always available and offline. The optional ML
 * model is lazy-loaded from cache; if it is not present (or the Transformers.js
 * runtime is unavailable) the worker silently falls back to deterministic, so a
 * missing model never blocks classification.
 */

type ClassifyRequest = {
  type: "classify";
  rows: ClassifyRowInput[];
  /** Which rows to classify: always = every row, fallback = only blanks. */
  mode: ClassifyMode;
  /** Whether to load the ML model when available. Independent of mode. */
  useMl: boolean;
  /** Model id recorded in the result-cache key (e.g. "mobilebert"). */
  modelId: string;
  /** Whether the result cache is enabled (default true). */
  cacheEnabled: boolean;
};

type ChunkResult = {
  type: "chunk";
  done: number;
  total: number;
  /** Cumulative count of tickets the classifier could not label at all. */
  notClassified: number;
  results: Array<{
    sysId: string;
    number: string;
    solutionType: string | null;
    solutionConfidence: number;
    solutionSource: "ml" | "heuristic";
    rootCause: string | null;
    rootCauseConfidence: number;
    rootCauseSource: "ml" | "heuristic";
  }>;
};

function isRequest(msg: unknown): msg is ClassifyRequest {
  return !!msg && typeof msg === "object" && (msg as any).type === "classify";
}

type PickFn = (input: ClassifyRowInput) => Promise<{ solutionType: import("./ml-classify.ts").CellPicks; rootCause: import("./ml-classify.ts").CellPicks }>;

let mlPicker: PickFn | null = null;

/**
 * Lazily loads the ML classifier. When the model cache is populated and the
 * Transformers.js runtime builds, `mlPicker` becomes an async wrapper around a
 * zero-shot model that yields the raw ML+deterministic picks per cell; otherwise
 * we stay on the deterministic scorer. Any parse or build error is swallowed
 * (logged to the console) so classification never hangs on an incomplete
 * download.
 */
async function ensureMl(): Promise<PickFn | null> {
  if (mlPicker) return mlPicker;
  try {
    console.log("[classifier:worker] loading ML module…");
    const { createMlPicker } = await import("./ml-classify.ts");
    mlPicker = await createMlPicker();
    console.log(`[classifier:worker] ML loaded=${!!mlPicker}`);
  } catch (err) {
    console.warn("[classifier] ML unavailable, using deterministic scorer", err);
    mlPicker = null;
  }
  return mlPicker;
}

let mlReady: Promise<PickFn | null> | null = null;

function getMl(): Promise<PickFn | null> {
  if (!mlReady) mlReady = ensureMl().catch(() => null);
  return mlReady;
}

function postChunk(
  results: ChunkResult["results"],
  done: number,
  total: number,
  notClassified: number
): void {
  (self as unknown as Worker).postMessage({ type: "chunk", done, total, notClassified, results } satisfies ChunkResult);
}

/** A row is unclassifiable when the classifier found no label at all — no notes,
 *  or both solutionType and rootCause came back null. */
function isUnclassifiable(r: { solutionType: { value: string | null }; rootCause: { value: string | null } }): boolean {
  return !r.solutionType.value && !r.rootCause.value;
}

async function classifyBatch(
  inputs: ClassifyRowInput[],
  mode: ClassifyMode,
  useMl: PickFn | null,
  cache: ClassificationCacheStore | null,
  modelId: string
): Promise<{ rowOut: ChunkResult["results"][number]; unclassifiable: boolean }[]> {
  const out: { rowOut: ChunkResult["results"][number]; unclassifiable: boolean }[] = [];
  for (const input of inputs) {
    const r = await classifyCached(input, useMl, cache, modelId);
    const number = String(input.row.number ?? input.row.sysId ?? "");
    out.push({
      rowOut: {
        sysId: String(input.row.sysId ?? ""),
        number,
        solutionType: r.solutionType.value,
        solutionConfidence: r.solutionType.confidence,
        solutionSource: r.solutionType.source,
        rootCause: r.rootCause.value,
        rootCauseConfidence: r.rootCause.confidence,
        rootCauseSource: r.rootCause.source
      },
      unclassifiable: isUnclassifiable(r)
    });
    // Log every classification so the user can see what was put where and how
    // sure the scorer was — useful for tuning hints and reviewing low-confidence
    // rows without opening each cell.
    const method = useMl ? "ml" : "regex";
    console.log(
      `[classifier:${method}] ${number}`,
      `rootCause=${String(r.rootCause.value ?? "-")} (${(r.rootCause.confidence * 100).toFixed(0)}%)`,
      `solution=${String(r.solutionType.value ?? "-")} (${(r.solutionType.confidence * 100).toFixed(0)}%)`,
      `notes=${input.notes.slice(0, 80)}`
    );
  }
  return out;
}

/** The cache key for one input row (notes + both label lists + model id). */
function keyFor(input: ClassifyRowInput, modelId: string): CacheKeyInput {
  return {
    notes: input.notes,
    rootCauseLabels: input.rootCauseLabels,
    resolutionLabels: input.resolutionLabels,
    modelId
  };
}

/** Computes (or reuses) the verdict for one input, honoring the result cache.
 *  The cache stores the RAW per-engine picks (ML + deterministic), so the final
 *  verdict is re-derived with the current decision rule on every read — a rule
 *  change is picked up without invalidating cached ML inference. */
async function classifyCached(
  input: ClassifyRowInput,
  useMl: PickFn | null,
  cache: ClassificationCacheStore | null,
  modelId: string
): Promise<{ solutionType: { value: string | null; confidence: number; source: "ml" | "heuristic" }; rootCause: { value: string | null; confidence: number; source: "ml" | "heuristic" } }> {
  const key = keyFor(input, modelId);
  if (cache) {
    const hit = await cache.get(key);
    // Only trust cached entries that carry per-cell raw picks (ml + det). Older
    // entries frozen at a final verdict are stale — rewrite them from a fresh
    // compute so the current rule applies (self-healing, one-time cost).
    if (hit && hasEnginePicks(hit.outcome)) {
      await cache.noteHit(key);
      return resolveOutcome(hit.outcome);
    }
  }
  let picks: { solutionType: CellPicks; rootCause: CellPicks };
  if (useMl) {
    picks = await useMl(input);
  } else {
    const det = deterministicClassify(input);
    const detSame = (c: ClassifyCell): EnginePick => ({ value: c.value, confidence: c.confidence, source: "heuristic" });
    picks = {
      rootCause: { ml: null, det: detSame(det.rootCause) },
      solutionType: { ml: null, det: detSame(det.solutionType) }
    };
  }
  if (cache) {
    const entry: ClassifyCacheEntry = { outcome: picks, savedAt: Date.now(), hits: 0 };
    await cache.put(key, entry);
  }
  return resolveOutcome(picks);
}

/** True when a cached outcome records the raw per-cell picks (ml + det). */
function hasEnginePicks(
  r: { solutionType?: { ml?: unknown; det?: unknown }; rootCause?: { ml?: unknown; det?: unknown } }
): boolean {
  return !!(r && typeof r.rootCause === "object" && r.rootCause && "ml" in r.rootCause && "det" in r.rootCause
    && typeof r.solutionType === "object" && r.solutionType && "ml" in r.solutionType && "det" in r.solutionType);
}

/** Incrementally posts each ticket so the viewer gets per-row live progress. */
(self as unknown as Worker).onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (!isRequest(msg)) return;
  if (msg.rows.length === 0) {
    postChunk([], 0, 0, 0);
    return;
  }

  const useMl = msg.useMl ? await getMl() : null;
  const cache = msg.cacheEnabled ? new ClassificationCacheStore() : null;
  const modelId = msg.modelId || "deterministic";
  const total = msg.rows.length;
  let done = 0;
  let notClassified = 0;
  for (const input of msg.rows) {
    const [{ rowOut, unclassifiable }] = await classifyBatch([input], msg.mode, useMl, cache, modelId);
    done++;
    if (unclassifiable) notClassified++;
    // One message per ticket: progress walks 1/49, 2/49, ... live.
    postChunk([rowOut], done, total, notClassified);
  }
};

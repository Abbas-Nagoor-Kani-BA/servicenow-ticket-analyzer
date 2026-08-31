import { createIdbDatabase, createMemoryDatabase } from "./idb.ts";
import type { IdbDatabase } from "./idb.ts";

/*
 * Standalone model cache for the optional ML classifier.
 *
 * The model lives in its OWN IndexedDB database (`snAnalyzerMlModel`), never in
 * `snAnalyzerCache` — the Settings page's "Clear pull cache" button calls
 * `getDefaultDatabase().clearAll()`, which now only clears data. The model is
 * downloaded once, cached as raw bytes, and read back by the viewer's worker.
 *
 * Download itself is a plain fetch; the caller owns the network (Settings page
 * has the huggingface.co host permission). This repository is storage-only.
 */

const MODEL_DB = "snAnalyzerMlModel";
const MODEL_DB_VERSION = 1;
const MODEL_STORES = ["meta", "files"];

/** Abort a single file's fetch after this long so a stalled download reports
 *  a real error instead of hanging forever on "Downloading…". */
const FILE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * The default classifier the extension ships. Settings downloads exactly these
 * files; the worker verifies the cache matches this spec before loading, so the
 * two never drift apart. (25.7 MB quantized English NLI — small enough to get
 * through a first-use download reliably.)
 */
export const CLASSIFIER_MODEL: MlModelSpec = {
  repoId: "Xenova/mobilebert-uncased-mnli",
  files: ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"]
};

/** A selectable model option shown in the Settings ML card. */
export type MlModelOption = {
  id: string;
  label: string;
  description: string;
  spec: MlModelSpec;
};

/**
 * Catalog of classifiers the user can download from Settings. All are real
 * zero-shot NLI models that run under Transformers.js (wasm). Sizes are the
 * quantized onnx the worker loads.
 */
export const ML_MODEL_CATALOG: MlModelOption[] = [
  {
    id: "mobilebert",
    label: "MobileBERT (English) — 25.7 MB",
    description: "Fast, tiny, first-use friendly. Best default.",
    spec: CLASSIFIER_MODEL
  },
  {
    id: "distilbert",
    label: "DistilBERT (English) — 64.5 MB",
    description: "Better accuracy than MobileBERT, still quick to download.",
    spec: {
      repoId: "Xenova/distilbert-base-uncased-mnli",
      files: ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"]
    }
  },
  {
    id: "deberta",
    label: "NLI DeBERTa v3 (English) — 233 MB",
    description: "Highest accuracy; a much larger one-time download.",
    spec: {
      repoId: "Xenova/nli-deberta-v3-base",
      files: ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"]
    }
  }
];

/** Looks up a catalog model by its id (e.g. "distilbert"), or null. */
export function modelById(id: string | undefined | null): MlModelOption | null {
  if (!id) return null;
  return ML_MODEL_CATALOG.find((m) => m.id === id) || null;
}

/** Looks up a catalog model by repoId (e.g. "Xenova/..."), or null. */
export function modelByRepoId(repoId: string | undefined | null): MlModelOption | null {
  if (!repoId) return null;
  return ML_MODEL_CATALOG.find((m) => m.spec.repoId === repoId) || null;
}

/**
 * Resolves the spec to use for a given selected model id. Falls back to the
 * default model when the id is unknown/blank. This is what the worker loads and
 * what Settings downloads.
 */
export function specForModelId(id: string | undefined | null): MlModelSpec {
  return modelById(id)?.spec || CLASSIFIER_MODEL;
}

/** Fetches one file, aborting if it stalls, and buffers the bytes. Reports
 *  streamed byte progress so the UI can show a live percentage. */
async function downloadOne(
  url: string,
  file: string,
  onBytes?: (bytes: number) => void
): Promise<ArrayBuffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FILE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Download failed (${res.status}) for ${file}`);
    const length = res.headers?.get ? res.headers.get("content-length") : null;
    const contentLength = Number(length ?? 0);
    const total = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0;
    if (!res.body || typeof res.body.getReader !== "function") {
      return await res.arrayBuffer();
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done: isEnd, value } = await reader.read();
      if (isEnd) break;
      chunks.push(value);
      loaded += value.length;
      onBytes?.(total ? Math.round((loaded / total) * 100) : loaded);
    }
    const out = new Uint8Array(loaded);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out.buffer;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error(`Timed out downloading ${file}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export type MlModelSpec = {
  /** HuggingFace model id, e.g. "Xenova/bert-base-multilingual-uncased". */
  repoId: string;
  /** Files to fetch from `https://huggingface.co/<repoId>/resolve/main/<file>`. */
  files: string[];
  /** Substring used for host permission (defaults to huggingface.co). */
  baseUrl?: string;
};

export type MlModelMeta = {
  repoId: string;
  savedAt: number;
  files: string[];
};

export type DownloadProgress = {
  /** Files finished so far. */
  done: number;
  /** Total files to fetch. */
  total: number;
  /** Current file being downloaded, or null when between files. */
  file: string | null;
  /** Bytes streamed so far for the current file (undefined for finished files). */
  bytes?: number;
};

export interface MlModelRepository {
  /** True when the model recorded in meta has all its files present. */
  isReady(): Promise<boolean>;
  /** True when the cached model is the one described by `spec`, with every file present. */
  matches(spec: MlModelSpec): Promise<boolean>;
  getMeta(): Promise<MlModelMeta | null>;
  /** Returns the cached bytes for one file of `spec`, or undefined. */
  getFile(spec: MlModelSpec, file: string): Promise<ArrayBuffer | undefined>;
  /** Downloads and caches every file in the spec. Other cached models are kept. */
  download(spec: MlModelSpec, onProgress?: (p: DownloadProgress) => void): Promise<MlModelMeta>;
  clear(): Promise<void>;
}

export class MlModelStore implements MlModelRepository {
  static readonly deps = [] as const;

  private readonly db: IdbDatabase;

  constructor(db: IdbDatabase = createIdbDatabase(MODEL_DB, MODEL_DB_VERSION, MODEL_STORES)) {
    this.db = db;
  }

  private metaKey = "meta";
  private fileKey = (repoId: string, file: string): string => `file:${repoId}:${file}`;

  async isReady(): Promise<boolean> {
    const meta = await this.db.store("meta").get<MlModelMeta | undefined>(this.metaKey);
    if (!meta || !meta.files.length) return false;
    const files = this.db.store("files");
    for (const f of meta.files) {
      if (!(await files.get(this.fileKey(meta.repoId, f)))) return false;
    }
    return true;
  }

  async getMeta(): Promise<MlModelMeta | null> {
    const meta = await this.db.store("meta").get<MlModelMeta | undefined>(this.metaKey);
    return meta ?? null;
  }

  async matches(spec: MlModelSpec): Promise<boolean> {
    // Models are cached independently (files keyed per repoId). A spec "matches"
    // when every one of its files is present — regardless of which model meta
    // currently records as "last downloaded". This lets the Settings page show
    // every downloaded model as ready, not just the most recent one.
    const files = this.db.store("files");
    for (const f of spec.files) {
      if (!(await files.get(this.fileKey(spec.repoId, f)))) return false;
    }
    return true;
  }

  async getFile(spec: MlModelSpec, file: string): Promise<ArrayBuffer | undefined> {
    const v = await this.db.store("files").get(this.fileKey(spec.repoId, file));
    return v as ArrayBuffer | undefined;
  }

  async download(spec: MlModelSpec, onProgress?: (p: DownloadProgress) => void): Promise<MlModelMeta> {
    const base = (spec.baseUrl || "https://huggingface.co") + `/${spec.repoId}/resolve/main/`;
    const files = this.db.store("files");
    const done = new Set<string>();

    // Files live under the model's own repoId, so downloading a different model
    // never touches a previously downloaded one.
    for (const file of spec.files) {
      if (await files.get(this.fileKey(spec.repoId, file))) done.add(file);
    }
    onProgress?.({ done: done.size, total: spec.files.length, file: null });

    for (const file of spec.files) {
      if (done.has(file)) continue;
      const url = base + encodeURIComponent(file);
      const bytes = await downloadOne(url, file, (pct) =>
        onProgress?.({ done: done.size, total: spec.files.length, file, bytes: pct })
      );
      await files.put(this.fileKey(spec.repoId, file), bytes);
      done.add(file);
      onProgress?.({ done: done.size, total: spec.files.length, file: null });
    }

    // Persist meta only after every file landed, so isReady() never sees a
    // half-downloaded model. meta records the most recently downloaded model.
    const meta: MlModelMeta = { repoId: spec.repoId, savedAt: Date.now(), files: [...spec.files] };
    await this.db.store("meta").put(this.metaKey, meta);
    return meta;
  }

  async clear(): Promise<void> {
    await this.db.store("meta").clear();
    await this.db.store("files").clear();
  }
}

/** In-memory twin for tests: same store shape, no IndexedDB. */
export function createMemoryMlModelRepository(): MlModelRepository {
  const db = createMemoryDatabase(MODEL_STORES);
  return new MlModelStore(db);
}

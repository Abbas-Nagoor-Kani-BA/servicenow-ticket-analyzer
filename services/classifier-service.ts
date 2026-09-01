import { classifyMsr } from "../core/msrcategorize.ts";
import type { MsrScore } from "../core/msrcategorize.ts";
import { msrType, rootCauseFor } from "../core/msrchoices.ts";
import type { MsrListSet } from "../core/msrchoices.ts";
import { ClassificationCacheStore } from "../data/classification-cache-repository.ts";
import type { ClassificationCacheRepository, CacheKeyInput } from "../data/classification-cache-repository.ts";

/*
 * Viewer-facing orchestrator for MSR-aware classification.
 *
 * This mirrors ExtractService's shape (per-row, fill-if-blank, review flag,
 * reported counts) but adds two things the heuristic does not have:
 *
 *   - it classifies against the ticket's OWN MSR option lists (root cause is
 *     per ticket type; solution type is the resolution list), so the result is
 *     always a value the grid/paste/export already validate against; and
 *   - it can run out of the hot path, batching rows per animation frame, so a
 *     large dataset never freezes the UI.
 *
 * The compute (deterministic `classifyMsr` here, or a Transformers.js model in
 * a worker) is supplied as `classify`, which keeps this service pure and
 * testable offline. It touches no DOM and performs no I/O beyond the injected
 * per-row mutation.
 */

export type ClassifyMode = "always" | "fallback";

export type ClassifyRowInput = {
  row: Record<string, any>;
  notes: string;
  rootCauseLabels: string[];
  resolutionLabels: string[];
};

export type ClassifyCell = {
  value: string | null;
  confidence: number;
};

/** The compute per row: notes + the two candidate lists -> both fields. */
export type ClassifyOutcome = {
  solutionType: ClassifyCell;
  rootCause: ClassifyCell;
};

/** The compute per row: notes + the two candidate lists -> both fields. */
export type ClassifyFn = (input: ClassifyRowInput) => ClassifyOutcome | Promise<ClassifyOutcome>;

export type ClassifyStats = {
  total: number;
  withNotes: number;
  classifiedRootCause: number;
  classifiedSolutionType: number;
  lowConfidence: number;
};

export type ClassifyServiceDeps = {
  /** Defaults to the offline deterministic scorer. Tests inject a fake. */
  classify?: ClassifyFn;
  /** How many rows to process per animation frame. */
  batchSize?: number;
  /** Per-batch callback after a group of rows is classified and patched. */
  onProgress?: (done: number, total: number) => void;
  /** Enable the durable per-note result cache (default true). */
  cacheEnabled?: boolean;
  /** Cache for classification outcomes; defaults to the IDB-backed store. */
  cache?: ClassificationCacheRepository;
  /** Model id recorded in the cache key ("deterministic" when ML is off). */
  modelId?: string;
};

/** Deterministic compute: root cause -> per-type list, solution type -> resolution. */
export const deterministicClassify: ClassifyFn = (input) => {
  const rootCause = classifyMsr(input.notes, input.rootCauseLabels);
  const solutionType = classifyMsr(input.notes, input.resolutionLabels);
  return {
    solutionType: { value: solutionType.label, confidence: solutionType.confidence },
    rootCause: { value: rootCause.label, confidence: rootCause.confidence }
  };
};

export class ClassifierService {
  private readonly classify: ClassifyFn;
  private readonly batchSize: number;
  private readonly onProgress: ((done: number, total: number) => void) | undefined;
  private readonly cache: ClassificationCacheRepository | null;
  private readonly modelId: string;

  constructor(deps: ClassifyServiceDeps = {}) {
    this.classify = deps.classify || deterministicClassify;
    this.batchSize = deps.batchSize || 25;
    this.onProgress = deps.onProgress;
    this.modelId = deps.modelId || "deterministic";
    const cacheEnabled = deps.cacheEnabled !== false;
    this.cache = cacheEnabled ? (deps.cache || new ClassificationCacheStore()) : null;
  }

  /** Full cache key for an input row: notes + both label lists + model id. */
  private keyFor(input: ClassifyRowInput): CacheKeyInput {
    return {
      notes: input.notes,
      rootCauseLabels: input.rootCauseLabels,
      resolutionLabels: input.resolutionLabels,
      modelId: this.modelId
    };
  }

  /**
   * Classifies one input, served from the durable result cache when present.
   * On a miss it runs the (deterministic or injected) compute and stores the
   * outcome, so an unchanged note is never re-scored across loads/datasets.
   */
  private async classifyCached(input: ClassifyRowInput): Promise<ClassifyOutcome> {
    const key = this.keyFor(input);
    const hit = await this.cache?.get(key);
    if (hit) {
      await this.cache?.noteHit(key);
      return hit.outcome as ClassifyOutcome;
    }
    const out = await this.classify(input);
    await this.cache?.put(key, { outcome: out, savedAt: Date.now(), hits: 0 });
    return out;
  }

  /**
   * Builds the per-row inputs for every row that has notes and at least one
   * blank target field. Rows already carrying both a solution type and a root
   * cause are skipped (fill-if-blank), matching ExtractService.
   */
  buildInputs(rows: Record<string, any>[], lists: MsrListSet): ClassifyRowInput[] {
    const inputs: ClassifyRowInput[] = [];
    for (const row of rows) {
      const notes = String(row.closeNotes ?? "").trim();
      if (!notes) continue;
      const typeLabel = msrType(row.number);
      const rcLabels = rootCauseFor(lists.rootCause, typeLabel);
      const resLabels = lists.resolution;
      inputs.push({
        row,
        notes,
        rootCauseLabels: rcLabels,
        resolutionLabels: resLabels
      });
    }
    return inputs;
  }

  /**
   * Whether a row needs re-classification under the given mode.
   *
   * - always: classify even if the row already has values (re-run over all).
   * - fallback: only fill blanks — the deterministic/regex fast path is used
   *   first by the caller, so anything already filled is left alone.
   */
  protected needsClassify(row: Record<string, any>, mode: ClassifyMode): boolean {
    if (mode === "always") return true;
    return !row.solutionType || !row.rootCause;
  }

  /**
   * Classifies the selected rows, batching per animation frame, mutating rows
   * in place, and flagging low-confidence results for review. Returns counts.
   *
   * `mode` decides fill-if-blank vs re-run-everything; `commitRow` applies a
   * result to a row (the caller owns exactly how a value lands on the row), so
   * this service stays free of row-shape assumptions.
   */
  async run(
    rows: Record<string, any>[],
    lists: MsrListSet,
    mode: ClassifyMode,
    commitRow: (row: Record<string, any>, input: ClassifyRowInput, out: ClassifyOutcome) => void
  ): Promise<ClassifyStats> {
    const stats: ClassifyStats = {
      total: rows.length,
      withNotes: 0,
      classifiedRootCause: 0,
      classifiedSolutionType: 0,
      lowConfidence: 0
    };

    const candidates = rows.filter((row) => {
      const notes = String(row.closeNotes ?? "").trim();
      if (!notes) return false;
      stats.withNotes++;
      return this.needsClassify(row, mode);
    });

    let done = 0;
    for (let i = 0; i < candidates.length; i += this.batchSize) {
      const chunk = candidates.slice(i, i + this.batchSize);
      for (const row of chunk) {
        const input = this.buildInputs([row], lists)[0];
        if (!input) continue;
        const out = await this.classifyCached(input);
        this.applyOutcome(row, input, out, commitRow, stats);
        done++;
      }
      this.onProgress?.(done, candidates.length);
      if (i + this.batchSize < candidates.length) await frame();
    }

    this.onProgress?.(candidates.length, candidates.length);
    return stats;
  }

  protected applyOutcome(
    row: Record<string, any>,
    input: ClassifyRowInput,
    out: ClassifyOutcome,
    commitRow: (row: Record<string, any>, input: ClassifyRowInput, out: ClassifyOutcome) => void,
    stats: ClassifyStats
  ): void {
    commitRow(row, input, out);
    if (out.rootCause.value) stats.classifiedRootCause++;
    if (out.solutionType.value) stats.classifiedSolutionType++;
    if (
      (out.rootCause.value && out.rootCause.confidence < 0.5) ||
      (out.solutionType.value && out.solutionType.confidence < 0.5)
    ) {
      stats.lowConfidence++;
    }
  }
}

// Re-exported so the stored-format check stays in one place.
export { msrType, rootCauseFor };
export type { MsrScore };

/** Yields to the browser between batches; falls back to a macrotask in node. */
function frame(): Promise<void> {
  const raf = (globalThis as any).requestAnimationFrame;
  if (typeof raf === "function") return new Promise((r) => raf(() => r()));
  return new Promise((r) => setTimeout(r, 0));
}

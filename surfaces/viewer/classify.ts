import { loadOnce } from "../../lib/storage.ts";
import { STORAGE } from "../../lib/keys.ts";
import { MlModelStore, specForModelId } from "../../data/ml-model-repository.ts";
import { dataStore, getMsrLists } from "./store.ts";
import { msrType, rootCauseFor, normResolution } from "../../core/msrchoices.ts";
import { classifyMsr } from "../../core/msrcategorize.ts";

/*
 * Data-View MSR classifier runner.
 *
 * Modes (settings ml.mode):
 *   - heuristic -> deterministic only (core/msrcategorize), inline; no worker.
 *   - hybrid    -> deterministic first (fills likely labels), then the worker
 *                  (Transformers.js) fills any cells the scorer left blank.
 *   - ml        -> the worker evaluates every note row; the deterministic
 *                  cascade is still authoritative and ML fills the blanks. ml
 *                  and hybrid therefore converge on the same verdict.
 *
 * Results stream back in chunks and are applied via `updateRow` (mapped onto
 * DataGrid.updateRows), so the view fills in incrementally. No DOM, no chrome.*
 * beyond reading the persisted settings once.
 */

type SettingsMl = { mode?: "heuristic" | "ml" | "hybrid"; modelId?: string; cacheEnabled?: boolean };

export type ClassifyRun = {
  total: number;
  withNotes: number;
  classified: number;
  changed: number;
  /** sysIds whose cells changed, for updateRows(). */
  changedSysIds: string[];
  /** A user-facing note when ML was requested but the model is not downloaded. */
  notice?: string;
};

export type ClassifyCallbacks = {
  onProgress: (done: number, total: number, notClassified: number) => void;
  /** Live tallies of the classified values, for the stats bar. */
  onStats: (stats: ClassifyStats) => void;
  /** Apply one classified row's values. */
  updateRow: (
    row: Record<string, any>,
    solutionType: string | null,
    rootCause: string | null,
    solutionConfidence?: number,
    rootCauseConfidence?: number
  ) => void;
};

export type ClassifyStats = {
  done: number;
  total: number;
  notClassified: number;
  solutionType: Record<string, number>;
  rootCause: Record<string, number>;
};

function makeStats(total: number): ClassifyStats {
  return { done: 0, total, notClassified: 0, solutionType: {}, rootCause: {} };
}

/**
 * Records live progress (done / notClassified). The value tallies are NOT kept
 * here — they are recomputed from the committed rows by the viewer's
 * `clsStatsShow` (deduped by sysId, valid MSR values only), so a row touched by
 * BOTH the deterministic and ML passes in fallback mode is counted exactly once.
 */
function tally(
  stats: ClassifyStats,
  done: number,
  notClassified: number,
  _solutionType: string | null,
  _rootCause: string | null
): void {
  stats.done = done;
  stats.notClassified = notClassified;
}

function buildInput(row: Record<string, any>) {
  const lists = getMsrLists();
  return {
    row,
    notes: String(row.closeNotes ?? "").trim(),
    rootCauseLabels: rootCauseFor(lists.rootCause, msrType(row.number)),
    resolutionLabels: lists.resolution,
    hints: lists.hints
  };
}

function inList(list: string[], value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  const v = String(value);
  return list.some((o) => o.toLowerCase() === v.toLowerCase());
}

/** A root cause cell is a real MSR category only if it is a member of this
 *  ticket's root-cause list. Free-text analysis left by autoParse is NOT. */
function hasValidRootCause(row: Record<string, any>): boolean {
  const labels = rootCauseFor(getMsrLists().rootCause, msrType(row.number));
  return inList(labels, row.rootCause);
}

/** A solution type cell is a real value only if it is in the resolution list. */
function hasValidSolutionType(row: Record<string, any>): boolean {
  return inList(getMsrLists().resolution, normResolution(row.solutionType));
}

/** Rows that actually carry notes worth classifying. */
function rowsWithNotes(rows: Record<string, any>[]): Record<string, any>[] {
  return rows.filter((r) => String(r.closeNotes ?? "").trim());
}

/** True when the selected ML model is fully downloaded and ready to load. */
async function modelAvailable(modelId: string): Promise<boolean> {
  try {
    return await new MlModelStore().matches(specForModelId(modelId));
  } catch {
    return false;
  }
}

/** FNV-1a hash of the note text, used to detect an unchanged note cheaply. */
function hashNotes(notes: string): string {
  return hashStr(notes, "n");
}

function hashStr(s: string, prefix: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return `${prefix}:${h.toString(16)}:${s.length}`;
}

/** A stable fingerprint of the MSR label lists that classification is scored
 *  against (root-cause buckets + resolution + per-label keyword hints), so an
 *  edited list is detected. */
export function classificationListsFp(lists: unknown): string {
  const rc = ((lists as any)?.rootCause) || {};
  const hints = ((lists as any)?.hints) || {};
  const parts: unknown[][] = [
    rc.Incident || [],
    rc.RFS || [],
    rc.P_Ticket || [],
    (lists as any)?.resolution || []
  ];
  const hintParts = Object.keys(hints)
    .sort()
    .map((k) => `${k}=${((hints as any)[k] || []).join("\u0000")}`);
  const joined = [...parts.map((arr) => arr.join("\u0000")), hintParts.join("\u0001")].join("\u0002");
  return hashStr(joined, "lists");
}

/** The classification context (model + label lists) that produced a row's value. */
function runFp(modelId: string): string {
  return `${modelId}::${classificationListsFp(getMsrLists())}`;
}

/** A row already carries BOTH real MSR categories AND its note text is unchanged
 *  AND it was classified under the current context (model + label lists).
 *  Free-text root-cause analysis (from autoParse) does not count as classified.
 *  `fp` is the current `runFp()`; when undefined the context check is skipped
 *  (legacy callers). */
function alreadyClassified(row: Record<string, any>, notes: string, fp?: string): boolean {
  if (!hasValidRootCause(row) || !hasValidSolutionType(row)) return false;
  if (!row.notesHash) return false; // no recorded baseline -> assume it may have changed
  if (fp !== undefined && row.__classFp !== fp) return false; // model/list changed the context
  return row.notesHash === hashNotes(notes);
}

/** Maps a heuristic stage to the source string stamped on a classified cell. */
function sourceFor(level: "regex" | "keyword" | "cosine" | null): string {
  return level === "regex" ? "regex" : level === "keyword" ? "keyword" : level === "cosine" ? "cosine" : "heuristic";
}

function deterministicPass(
  rows: Record<string, any>[],
  onlyBlank: boolean,
  cb: ClassifyCallbacks,
  stats: ClassifyStats,
  modelId: string,
  fp: string
): { changed: number; changedSysIds: string[]; notClassified: number } {
  let changed = 0;
  let notClassified = 0;
  const changedSysIds: string[] = [];
  let done = 0;
  for (const row of rows) {
    done++;
    const input = buildInput(row);
    if (!input.notes) {
      notClassified++;
      cb.onProgress(done, rows.length, notClassified);
      tally(stats, done, notClassified, null, null);
      continue;
    }
    // Per-row cache: a row already carrying real MSR categories AND with
    // unchanged notes AND under the current context is left alone (no
    // recompute), regardless of mode. A model/list change (fp mismatch) forces
    // a re-run so a stale value from a previous run is not shown.
    if (alreadyClassified(row, input.notes, fp)) {
      cb.onProgress(done, rows.length, notClassified);
      cb.onStats(stats);
      continue;
    }
    if (onlyBlank && hasValidRootCause(row) && hasValidSolutionType(row)) {
      cb.onProgress(done, rows.length, notClassified);
      cb.onStats(stats);
      continue;
    }

    const result = classifyMsr(input.notes, input.rootCauseLabels, { hints: getMsrLists().hints });
    const solution = classifyMsr(input.notes, input.resolutionLabels, { hints: getMsrLists().hints });

    let toRootCause = result.label ?? row.rootCause ?? null;
    let toSolution = solution.label ?? row.solutionType ?? null;

    // Neither field labeled at all -> not classifiable.
    if (!toRootCause && !toSolution) notClassified++;

    console.log(
      `[classifier:regex] ${row.number ?? row.sysId ?? "?"}`,
      `rootCause=${String(toRootCause ?? "-")} (${(result.confidence * 100).toFixed(0)}%)`,
      `solution=${String(toSolution ?? "-")} (${(solution.confidence * 100).toFixed(0)}%)`,
      `notes=${input.notes.slice(0, 80)}`
    );

    // fallback mode keeps the deterministic cascade as the authority: only fill
    // blanks, never overwrite an existing MSR category with a new one. A
    // free-text root-cause analysis (not a category) IS overwritten so the
    // category gets set.
    if (onlyBlank) {
      if (!hasValidRootCause(row) && result.label) toRootCause = result.label;
      else toRootCause = hasValidRootCause(row) ? row.rootCause : null;
      if (!hasValidSolutionType(row) && solution.label) toSolution = solution.label;
      else toSolution = hasValidSolutionType(row) ? row.solutionType : null;
    }

    // Stamp which engine produced each cell so Calclens can explain it truthfully.
    // In fallback mode a field that was preserved (not newly produced here) keeps
    // its existing source; otherwise the produced field carries its heuristic stage.
    const rcProduced = !!toRootCause && (onlyBlank ? !hasValidRootCause(row) : true);
    const solProduced = !!toSolution && (onlyBlank ? !hasValidSolutionType(row) : true);
    if (rcProduced) row.__rcSource = sourceFor(result.level);
    if (solProduced) row.__solSource = sourceFor(solution.level);
    if (rcProduced) row.__rcConf = result.confidence;
    if (solProduced) row.__solConf = solution.confidence;
    if (!row.__modelId) row.__modelId = "deterministic";
    row.__classFp = fp;

    if (toRootCause !== row.rootCause || toSolution !== row.solutionType) {
      changed++;
      changedSysIds.push(String(row.sysId ?? ""));
    }
    row.notesHash = hashNotes(input.notes);
    cb.updateRow(row, toSolution, toRootCause, solution.confidence, result.confidence);
    cb.onProgress(done, rows.length, notClassified);
    tally(stats, done, notClassified, toSolution, toRootCause);
  }
  return { changed, changedSysIds, notClassified };
}

/** Runs ML in the worker for `targets`, streaming results. Progress is reported
 *  against the FULL dataset: `preDone` rows (note-less, already counted) lead the
 *  bar, and `totalRows` is the denominator, so "Classifying 22/34" reads like
 *  the ticket list rather than a sub-count of note-bearing rows. Rows with no
 *  notes (`preDone`) are counted as not-classifiable. */
/**
 * Resolves the value/source/confidence to commit for one classification cell.
 * The worker verdict is already decisive (deterministic cascade authoritatively
 * fills whatever it can, ML follows for the blanks), so in `fallback` mode a
 * value is preserved only when the worker genuinely produced nothing new.
 * Pure, so it is unit-tested.
 */
export function resolveApplyCell(
  worker: { value: string | null; source?: string; confidence?: number },
  current: { value: string | null; source?: unknown; confidence?: number },
  fallback: boolean
): { value: string | null; source: string; confidence: number } {
  const wValue = worker.value ?? null;
  const wSource = worker.source ?? "heuristic";
  const wConf = Number(worker.confidence) || 0;
  // Non-destructive: never erase an existing value when the worker returned no
  // label for the cell. Keep the current value and its source/confidence marker.
  if (wValue == null && current.value != null) {
    return { value: current.value, source: String(current.source || "unrecorded"), confidence: Number(current.confidence) || 0 };
  }
  if (!fallback) return { value: wValue, source: wSource, confidence: wConf };
  const mlWon = worker.source === "ml";
  const keep = !!current.value && !(current.source === "heuristic" && mlWon);
  if (keep) {
    return { value: current.value, source: String(current.source || "unrecorded"), confidence: Number(current.confidence) || 0 };
  }
  return { value: wValue, source: wSource, confidence: wConf };
}

function mlPass(
  targets: Record<string, any>[],
  mode: "always" | "fallback",
  totalRows: number,
  preDone: number,
  preDoneUnclassified: number,
  cb: ClassifyCallbacks,
  changedSysIds: string[],
  stats: ClassifyStats,
  modelId: string,
  cacheEnabled: boolean,
  fp: string
): Promise<void> {
  return import("./worker-client.ts").then(({ spawnClassifierWorker }) => {
    const w = spawnClassifierWorker();
    if (!w) return Promise.resolve();

    let done = preDone;
    return new Promise<void>((resolve) => {
      const handler = (e: MessageEvent) => {
        const msg = e.data;
        if (!msg || msg.type !== "chunk") return;
        for (const res of msg.results || []) {
          const row = targets.find((r) => String(r.sysId ?? "") === res.sysId);
          if (!row) continue;

          const rc = resolveApplyCell(
            { value: res.rootCause, source: res.rootCauseSource, confidence: res.rootCauseConfidence },
            { value: row.rootCause, source: row.__rcSource, confidence: row.__rcConf },
            mode === "fallback"
          );
          const sol = resolveApplyCell(
            { value: res.solutionType, source: res.solutionSource, confidence: res.solutionConfidence },
            { value: row.solutionType, source: row.__solSource, confidence: row.__solConf },
            mode === "fallback"
          );

          const before = row.rootCause !== rc.value || row.solutionType !== sol.value;
          if (before) changedSysIds.push(String(row.sysId ?? ""));
          row.notesHash = hashNotes(String(row.closeNotes ?? "").trim());
          row.rootCause = rc.value;
          row.solutionType = sol.value;
          row.__rcSource = rc.source;
          row.__solSource = sol.source;
          row.__rcConf = rc.confidence;
          row.__solConf = sol.confidence;
          row.__classFp = fp;
          if (modelId) row.__modelId = modelId;
          cb.updateRow(row, sol.value, rc.value, sol.confidence, rc.confidence);
          done++;
          tally(stats, done, (preDoneUnclassified || 0) + msg.notClassified, sol.value, rc.value);
        }
        // Live per-ticket progress, with the not-classified tally.
        cb.onProgress(preDone + msg.done, totalRows, (preDoneUnclassified || 0) + msg.notClassified);
        if (msg.done >= msg.total) {
          w.removeEventListener("message", handler);
          w.terminate();
          resolve();
        }
      };
      w.addEventListener("message", handler);
      w.postMessage({
        type: "classify",
        rows: targets.map((r) => buildInput(r)),
        mode,
        useMl: true,
        modelId,
        cacheEnabled
      });
    });
  });
}

/**
 * Classifies the current rows according to the settings.
 */
export async function classifyRows(cb: ClassifyCallbacks): Promise<ClassifyRun> {
  const data = dataStore.getState().data;
  const rows = data && Array.isArray(data.rows) ? data.rows : [];
  const total = rows.length;
  if (!total) return { total, withNotes: 0, classified: 0, changed: 0, changedSysIds: [] };

  const settings = await loadOnce<{ ml?: SettingsMl }>(STORAGE.pluginSettings, null);
  const ml = settings?.ml;
  // Single 3-way mode: heuristic only, ML only, or hybrid (heuristic then ML).
  const mode: "heuristic" | "ml" | "hybrid" =
    ml?.mode === "ml" ? "ml" : ml?.mode === "heuristic" ? "heuristic" : "hybrid";
  const modelId = ml?.modelId || "mobilebert";
  const cacheEnabled = ml?.cacheEnabled !== false;

  const withNotes = rowsWithNotes(rows).length;
  const preDone = total - withNotes; // note-less rows: not classifiable
  const fp = runFp(modelId);
  const changedSysIds: string[] = [];
  let changed = 0;
  const stats = makeStats(total);

  // ML was requested but the model isn't cached: degrade to the built-in scorer
  // and tell the user, so the worker never has to (misleadingly) warn mid-run.
  if (mode !== "heuristic" && !(await modelAvailable(modelId))) {
    const d = deterministicPass(rows, false, cb, stats, modelId, fp);
    cb.onProgress(total, total, d.notClassified);
    cb.onStats(stats);
    return {
      total,
      withNotes,
      classified: d.changed,
      changed: d.changed,
      changedSysIds: d.changedSysIds,
      notice: "ML model not downloaded — using the built-in scorer. Download it under Settings → Classification."
    };
  }

  // ML-only: the worker evaluates EVERY note row — including rows that already
  // carried heuristic values, so they get re-run. The deterministic cascade is
  // still authoritative and ML fills the blanks, so the verdicts match hybrid.
  // Rows already classified under the current context (model + lists) with
  // unchanged notes are skipped (the feature cache makes repeats cheap anyway).
  if (mode === "ml") {
    const targets = rowsWithNotes(rows).filter((r) => {
      const notes = String(r.closeNotes ?? "").trim();
      return !(r.__rcSource === "ml" && r.__solSource === "ml" && r.__classFp === fp && r.notesHash === hashNotes(notes));
    });
    stats.done = preDone;
    stats.notClassified = preDone;
    cb.onProgress(preDone, total, preDone);
    cb.onStats(stats);
    if (targets.length) {
      await mlPass(targets, "always", total, preDone, preDone, cb, changedSysIds, stats, modelId, cacheEnabled, fp);
    }
    cb.onProgress(total, total, preDone);
    cb.onStats(stats);
    changed = changedSysIds.length;
    return { total, withNotes, classified: targets.length, changed, changedSysIds };
  }

  // Hybrid: heuristic fills blanks first; ML then evaluates every note row and
  // fills any cell the scorer left blank (the deterministic cascade stays
  // authoritative, so an established heuristic value is never overridden).
  if (mode === "hybrid") {
    const d = deterministicPass(rows, true, cb, stats, modelId, fp);
    changedSysIds.push(...d.changedSysIds);
    const targets = rowsWithNotes(rows);
    stats.done = preDone;
    stats.notClassified = preDone;
    if (targets.length) {
      await mlPass(targets, "fallback", total, preDone, preDone, cb, changedSysIds, stats, modelId, cacheEnabled, fp);
    }
    cb.onProgress(total, total, preDone);
    cb.onStats(stats);
    changed = changedSysIds.length;
    return { total, withNotes, classified: targets.length, changed, changedSysIds };
  }

  // Heuristic-only: deterministic pass fills everything (non-blank rows kept).
  const d = deterministicPass(rows, false, cb, stats, modelId, fp);
  cb.onProgress(total, total, d.notClassified);
  cb.onStats(stats);
  return { total, withNotes, classified: d.changed, changed: d.changed, changedSysIds: d.changedSysIds };
}

export { hashNotes, alreadyClassified, hasValidRootCause, hasValidSolutionType };

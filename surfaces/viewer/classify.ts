import { loadOnce } from "../../lib/storage.ts";
import { STORAGE } from "../../lib/keys.ts";
import { dataStore, getMsrLists } from "./store.ts";
import { msrType, rootCauseFor, normResolution } from "../../core/msrchoices.ts";
import { classifyMsr } from "../../core/msrcategorize.ts";

/*
 * Data-View MSR classifier runner.
 *
 * Modes:
 *   - ML disabled         -> deterministic only (core/msrcategorize), inline.
 *   - ML enabled, fallback -> deterministic first (fills likely labels), then
 *                             the worker refines only rows that are still blank.
 *   - ML enabled, always   -> the worker (Transformers.js) classifies EVERY row;
 *                             the deterministic pass is skipped so regex results
 *                             are never written ahead of, or in place of, ML.
 *
 * Results stream back in chunks and are applied via `updateRow` (mapped onto
 * DataGrid.updateRows), so the view fills in incrementally. No DOM, no chrome.*
 * beyond reading the persisted settings once.
 */

type SettingsMl = { enabled?: boolean; mode?: "always" | "fallback"; modelId?: string; cacheEnabled?: boolean };

export type ClassifyRun = {
  total: number;
  withNotes: number;
  classified: number;
  changed: number;
  /** sysIds whose cells changed, for updateRows(). */
  changedSysIds: string[];
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
  return {
    row,
    notes: String(row.closeNotes ?? "").trim(),
    rootCauseLabels: rootCauseFor(getMsrLists().rootCause, msrType(row.number)),
    resolutionLabels: getMsrLists().resolution
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

/** FNV-1a hash of the note text, used to detect an unchanged note cheaply. */
function hashNotes(notes: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < notes.length; i++) {
    h ^= notes.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return `n:${h.toString(16)}:${notes.length}`;
}

/** A row already carries BOTH real MSR categories AND its note text is unchanged.
 *  Free-text root-cause analysis (from autoParse) does not count as classified. */
function alreadyClassified(row: Record<string, any>, notes: string): boolean {
  if (!hasValidRootCause(row) || !hasValidSolutionType(row)) return false;
  if (!row.notesHash) return false; // no recorded baseline -> assume it may have changed
  return row.notesHash === hashNotes(notes);
}

function deterministicPass(
  rows: Record<string, any>[],
  onlyBlank: boolean,
  cb: ClassifyCallbacks,
  stats: ClassifyStats
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
    // unchanged notes is left alone (no recompute), regardless of mode.
    if (alreadyClassified(row, input.notes)) {
      cb.onProgress(done, rows.length, notClassified);
      cb.onStats(stats);
      continue;
    }
    if (onlyBlank && hasValidRootCause(row) && hasValidSolutionType(row)) {
      cb.onProgress(done, rows.length, notClassified);
      cb.onStats(stats);
      continue;
    }

    const result = classifyMsr(input.notes, input.rootCauseLabels);
    const solution = classifyMsr(input.notes, input.resolutionLabels);

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

    // fallback mode keeps ML as the authority: only fill blanks, never overwrite
    // an existing MSR category with a regex one. A free-text root-cause analysis
    // (not a category) IS overwritten so the category gets set.
    if (onlyBlank) {
      if (!hasValidRootCause(row) && result.label) toRootCause = result.label;
      else toRootCause = hasValidRootCause(row) ? row.rootCause : null;
      if (!hasValidSolutionType(row) && solution.label) toSolution = solution.label;
      else toSolution = hasValidSolutionType(row) ? row.solutionType : null;
    }

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
  cacheEnabled: boolean
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
          const before = row.rootCause !== res.rootCause || row.solutionType !== res.solutionType;
          if (before) changedSysIds.push(String(row.sysId ?? ""));
          row.notesHash = hashNotes(String(row.closeNotes ?? "").trim());
          cb.updateRow(row, res.solutionType, res.rootCause, res.solutionConfidence, res.rootCauseConfidence);
          done++;
          tally(stats, done, (preDoneUnclassified || 0) + msg.notClassified, res.solutionType, res.rootCause);
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
  const useMl = !!ml?.enabled;
  const mode: "always" | "fallback" = ml?.mode === "always" ? "always" : "fallback";
  const modelId = ml?.modelId || "mobilebert";
  const cacheEnabled = ml?.cacheEnabled !== false;

  const withNotes = rowsWithNotes(rows).length;
  const preDone = total - withNotes; // note-less rows: not classifiable
  const changedSysIds: string[] = [];
  let changed = 0;
  const stats = makeStats(total);

  // ML-enabled "always": ML is the single source of truth. No deterministic
  // pass, so nothing is written ahead of the model.
  if (useMl && mode === "always") {
    // Per-row cache: only rows still lacking a value (or with changed notes) go
    // to ML; already-classified, unchanged rows are skipped.
    const targets = rowsWithNotes(rows).filter((r) => {
      const notes = String(r.closeNotes ?? "").trim();
      return !alreadyClassified(r, notes);
    });
    stats.done = preDone;
    stats.notClassified = preDone;
    cb.onProgress(preDone, total, preDone);
    cb.onStats(stats);
    if (targets.length) {
      await mlPass(targets, mode, total, preDone, preDone, cb, changedSysIds, stats, modelId, cacheEnabled);
    }
    cb.onProgress(total, total, preDone);
    cb.onStats(stats);
    changed = changedSysIds.length;
    return { total, withNotes, classified: targets.length, changed, changedSysIds };
  }

  // ML-enabled "fallback": deterministic fills blanks, ML refines the rest.
  if (useMl && mode === "fallback") {
    const d = deterministicPass(rows, true, cb, stats);
    changedSysIds.push(...d.changedSysIds);
    const blanks = rowsWithNotes(rows).filter((r) => !hasValidRootCause(r) || !hasValidSolutionType(r));
    if (blanks.length) {
      stats.done = withNotes - blanks.length;
      await mlPass(blanks, mode, total, preDone, preDone, cb, changedSysIds, stats, modelId, cacheEnabled);
    }
    cb.onProgress(total, total, preDone + blanks.length);
    cb.onStats(stats);
    changed = changedSysIds.length;
    return { total, withNotes, classified: withNotes, changed, changedSysIds };
  }

  // ML disabled: deterministic pass fills everything (non-blank rows are kept).
  const d = deterministicPass(rows, false, cb, stats);
  cb.onProgress(total, total, d.notClassified);
  cb.onStats(stats);
  return { total, withNotes, classified: d.changed, changed: d.changed, changedSysIds: d.changedSysIds };
}

export { hashNotes, alreadyClassified, hasValidRootCause, hasValidSolutionType };

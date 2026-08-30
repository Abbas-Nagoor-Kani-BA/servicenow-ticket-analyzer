import { extractHeuristic } from "../core/aiextract.ts";

/*
 * Viewer-facing wrapper over the closure-note heuristic (core/aiextract.ts).
 *
 * The heuristic itself is pure; this service owns the per-row apply loop the
 * viewer used to run by hand: fill solutionType/rootCause from the closure
 * notes, flag rows for human review whenever the confidence is not "high",
 * and report counts so the caller can decide the messaging. It touches no DOM
 * and performs no I/O.
 */

export type ExtractStats = {
  /** Number of rows inspected this call. */
  total: number;
  /** Rows that had closure notes at all. */
  withNotes: number;
  /** Rows where notes filled at least one field. */
  filled: number;
};

export class ExtractService {
  /** Runs the heuristic over every row and mutates the rows in place. */
  applyExtraction(rows: Record<string, any>[]): ExtractStats {
    const stats: ExtractStats = { total: rows.length, withNotes: 0, filled: 0 };
    for (const row of rows) {
      const notes = String(row.closeNotes ?? "").trim();
      if (!notes) continue;
      stats.withNotes++;
      if (row.solutionType && row.rootCause) continue;
      const h = extractHeuristic(notes);
      if (!h.solutionType && !h.rootCause) continue;
      row.solutionType = row.solutionType || h.solutionType;
      row.rootCause = row.rootCause || h.rootCause;
      const conf = h.confidence;
      if (
        (h.solutionType && conf && conf.solutionType !== "high") ||
        (h.rootCause && conf && conf.rootCause !== "high")
      ) {
        row.parseReview = true;
      }
      stats.filled++;
    }
    return stats;
  }
}
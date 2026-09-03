/**
 * Pure search matcher for the data grid.
 *
 * Decides whether a row matches the current search query given the chosen
 * column scope, match mode and case sensitivity. It has no viewer dependencies:
 * the caller injects a `displayValue(row, key, cls)` resolver so the match runs
 * against the SAME value the grid shows and the export writes (via
 * exportSvc.cellValue). That keeps "what you searched" aligned with "what gets
 * copied / exported" — both operate on the filtered rows.
 */
import type { SearchMode } from "./search-state.ts";

export type SearchColumn = readonly [string, string, string, number];

export type SearchOpts = {
  /** "" = all columns; otherwise a single grid column key. */
  column: string;
  mode: SearchMode;
  caseSensitive: boolean;
};

export type DisplayValue = (row: Record<string, any>, key: string, cls: string) => string;

function norm(s: string, caseSensitive: boolean): string {
  return caseSensitive ? s : s.toLowerCase();
}

/** Positive predicate for one value against the query for contains/equals. */
function hit(value: string, q: string, mode: SearchMode, caseSensitive: boolean): boolean {
  const v = norm(value, caseSensitive);
  const needle = norm(q, caseSensitive);
  if (mode === "contains" || mode === "notContains") return v.includes(needle);
  // equals / notEquals compare the full value.
  return v === needle;
}

const NEGATIVE = new Set<SearchMode>(["notContains", "notEquals"]);

/**
 * True when a row should be shown for the given query and options.
 *
 * - Empty query -> always true (no filtering), matching the original behaviour.
 * - Single column -> match just that column's displayed value.
 * - All columns -> positive modes match when ANY column matches; negative modes
 *   keep the row only when NO column matches.
 */
export function rowMatches(
  row: Record<string, any>,
  query: string,
  opts: SearchOpts,
  displayValue: DisplayValue,
  columns: readonly SearchColumn[]
): boolean {
  const q = String(query ?? "").trim();
  if (!q) return true;

  const negative = NEGATIVE.has(opts.mode);

  const targets = opts.column
    ? columns.filter(([k]) => k === opts.column)
    : columns;
  // A column that no longer exists (e.g. removed): fall back to no filtering.
  if (opts.column && targets.length === 0) return true;

  const anyPositiveHit = targets.some(([k, , cls]) =>
    hit(displayValue(row, k, cls), q, opts.mode, opts.caseSensitive)
  );

  // Negative modes ("does not contain/equal") keep the row when no target hits.
  return negative ? !anyPositiveHit : anyPositiveHit;
}

/**
 * Search controls state owner (session-only).
 *
 * Holds which column the search box targets, the match mode, and case
 * sensitivity. Like the Calclens mode flag this is never persisted: it always
 * starts at the defaults on page load (All columns, Contains, case-insensitive),
 * which reproduce the original all-column substring search. The viewer reads and
 * writes through these accessors so no other module owns the state.
 */

/** "" means "All columns"; otherwise a grid column key (e.g. "state", "rep:type"). */
export type SearchMode = "contains" | "equals" | "notContains" | "notEquals";

let column = "";
let mode: SearchMode = "contains";
let caseSensitive = false;

export function getSearchColumn(): string {
  return column;
}
export function setSearchColumn(key: string): void {
  column = typeof key === "string" ? key : "";
}

export function getSearchMode(): SearchMode {
  return mode;
}
export function setSearchMode(m: SearchMode): void {
  mode = m === "equals" || m === "notContains" || m === "notEquals" ? m : "contains";
}

export function isCaseSensitive(): boolean {
  return caseSensitive;
}
export function setCaseSensitive(on: boolean): void {
  caseSensitive = !!on;
}

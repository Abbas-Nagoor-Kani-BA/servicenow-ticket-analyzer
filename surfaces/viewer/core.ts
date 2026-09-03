import * as MsrChoices from "../../core/msrchoices.ts";
import { CELL_MAX, cellShort, placePopupNear } from "../../lib/markup.ts";
import { STORAGE } from "../../lib/keys.ts";
import { saveValue } from "../../lib/storage.ts";
import { uiStore, setHiddenCols, setMsrLists, getMsrLists } from "./store.ts";
import { ReportService } from "../../services/report-service.ts";

const report = new ReportService();

/** Rows are deserialized JSON from the pull pipeline; treat their fields as opaque. */
export type ViewerRow = Record<string, any>;
/** [key, label, cell class, width] — the grid-column descriptor. */
export type ViewerCol = readonly [string, string, string, number];
export type ViewerData = { rows: ViewerRow[]; debug?: { ticketsWithAudit?: number }; [k: string]: any };
export type MsrLists = ReturnType<typeof MsrChoices.mergeMsrLists>;

/** Instance-clock formatter used across the viewer and threaded into core reports. */
export type InstantFn = (utcIso: string, row: ViewerRow) => string;

/** @returns the element cast to any — DOM id lookups are inherently unsafe. */
const $ = (id: string): any => document.getElementById(id);

const COLUMNS: ViewerCol[] = [
  ["number", "Number", "num", 120],
  ["shortDescription", "Short description", "", 150],
  ["assignedTo", "Assigned to", "", 130],
  ["priority", "Priority", "", 95],
  ["state", "State", "", 105],
  ["assignmentGroup", "Group", "", 140],
  ["configItem", "Configuration item", "", 150],
  ["createdOn", "Created", "time", 155],
  ["assignTimeUtcIso", "Assign time", "inst", 155],
  ["acknTimeUtcIso", "Ackn time", "inst", 155],
  ["suspendTimeUtcIso", "Suspend time", "inst", 155],
  ["resumeTimeUtcIso", "Resume time", "inst", 155],
  ["resolvedAt", "Resolved", "time", 155],
  ["dur:assignToAckn", "Time to ackn", "dur", 120],
  ["dur:assignToResolve", "Time to resolve", "dur", 125],
  ["dur:suspendTotal", "Suspend total", "dur", 110],
  ["solutionType", "Solution type", "", 115],
  ["rootCause", "Root cause", "", 130],
  ["subCategory", "Sub category", "", 150],
  ["duplicateIncident", "Duplicate incident", "", 110],
  ["rep:type", "Type", "rep", 85],
  ["rep:incidentHours", "Incident hours", "rep", 105],
  ["rep:incidentTotalAge", "Incident total age", "rep", 120],
  ["rep:incCurrentHours", "Inc current hours (from ASG)", "rep", 160],
  ["rep:incidentCurrentAge", "Incident current age", "rep", 130],
  ["rep:responseSLA", "Response SLA", "rep", 105],
  ["rep:cumulativeSla", "Cumulative SLA", "rep", 110],
  ["rep:cumulativeDays", "Cumulative days", "rep", 115],
  ["rep:metResponseSLA", "Met response SLA", "rep", 120],
  ["rep:metMinResolutionSLA", "Met min resolution SLA", "rep", 140],
  ["rep:metMaxResolutionSLA", "Met max resolution SLA", "rep", 140],
  ["rep:analysedDate", "Analysed date", "rep", 105]
];

function hideStore(): Set<string> { return uiStore.getState().hiddenCols; }

function visibleCols(): ViewerCol[] {
  return COLUMNS.filter(([key]) => !hideStore().has(key));
}

/** Shared show/hide column mutation: enforces "at least one visible", mutates
 *  `hiddenCols` and persists it. Returns false when the change was refused. */
function setColumnVisible(key: string, show: boolean): boolean {
  const hc = hideStore();
  if (!show && COLUMNS.length - hc.size <= 1) return false;
  const next = new Set(hc);
  if (show) next.delete(key);
  else next.add(key);
  setHiddenCols(next);
  saveValue(STORAGE.viewerHiddenCols, [...next]).catch(() => undefined);
  return true;
}

function columnOptionList(key: string, row: ViewerRow): string[] | null {
  if (!row) return null;
  const lists = getMsrLists();
  switch (key) {
    case "solutionType": return lists.resolution;
    case "rootCause": return MsrChoices.rootCauseFor(lists.rootCause, MsrChoices.msrType(row.number));
    case "subCategory": return lists.subCategory;
    case "duplicateIncident": return lists.duplicate;
    case "assignmentGroup": return lists.queue;
    default: return null;
  }
}

function migrateLegacyResolutions(rows: ViewerRow[] | null | undefined): number {
  let changed = 0;
  for (const r of rows || []) {
    const n = MsrChoices.normResolution(r.solutionType);
    if (n && n !== r.solutionType) {
      r.solutionType = n;
      changed++;
    }
  }
  return changed;
}

function setStatus(text: string, isError = false): void {
  const el = $("status");
  el.textContent = text;
  el.style.color = isError ? "#f38ba8" : "#a6e3a1";
  setTimeout(() => { el.textContent = ""; }, 4000);
}

function el(tag: string, cls?: string): HTMLElement {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  return d;
}

function syncMsrLists(lists: unknown): void {
  setMsrLists(lists);
}

/**
 * The core report builder wants a one-arg formatter; the viewer's instants need
 * the row for per-row instance offsets. ReportService owns the adaptation — a
 * non-identity fmt also changes derived SLA results, not just text.
 */
function buildRep(row: ViewerRow, fmt: InstantFn): Record<string, any> {
  return report.rep(row, fmt);
}

function buildSlaSummaryFor(rows: ViewerRow[] | null | undefined, fmt: InstantFn) {
  return report.slaSummary(rows, fmt);
}

function buildSlaSummaryRowsFor(rows: ViewerRow[] | null | undefined, fmt: InstantFn) {
  return report.slaSummaryRows(rows, fmt);
}

export {
  visibleCols,
  hideStore,
  setColumnVisible,
  cellShort,
  columnOptionList,
  migrateLegacyResolutions,
  setStatus,
  placePopupNear,
  el,
  syncMsrLists,
  $,
  COLUMNS,
  CELL_MAX,
  buildRep,
  buildSlaSummaryFor,
  buildSlaSummaryRowsFor
};
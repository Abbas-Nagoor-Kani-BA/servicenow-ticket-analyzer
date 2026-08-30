import * as MsrChoices from "../../core/msrchoices.js";
import { CELL_MAX, cellShort, placePopupNear } from "../../lib/markup.js";
import { uiStore, setMsrLists, getMsrLists } from "./store.js";


/** @param {string} id @returns {any} */
const $ = id => document.getElementById(id);

/** @type {Array<[string, string, string, number]>} key, label, cell-class, width */
const COLUMNS = [
  ["number", "Number", "num", 120],
  ["shortDescription", "Short description", "", 150],
  ["assignedTo", "Assigned to", "", 130],
  ["priority", "Priority", "", 95],
  ["state", "State", "", 105],
  ["assignmentGroup", "Group", "", 140],
  ["configItem", "Configuration item", "", 150],
  ["incidentState", "Incident state", "", 110],
  ["createdOn", "Created", "time", 155],
  ["assignTimeUtcIso", "Assign time", "inst", 155],
  ["acknTimeUtcIso", "Ackn time", "inst", 155],
  ["suspendTimeUtcIso", "Suspend time", "inst", 155],
  ["resumeTimeUtcIso", "Resume time", "inst", 155],
  ["resolvedAt", "Resolved", "time", 155],
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

function hideStore() { return uiStore.getState().hiddenCols; }

function visibleCols() {
  return COLUMNS.filter(([key]) => !hideStore().has(key));
}

function columnOptionList(key, row) {
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

function migrateLegacyResolutions(rows) {
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

function setStatus(text, isError = false) {
  const el = $("status");
  el.textContent = text;
  el.style.color = isError ? "#f38ba8" : "#a6e3a1";
  setTimeout(() => { el.textContent = ""; }, 4000);
}

function el(tag, cls) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  return d;
}

function syncMsrLists(lists) {
  setMsrLists(lists);
}

export {
  visibleCols,
  hideStore,
  cellShort,
  columnOptionList,
  migrateLegacyResolutions,
  setStatus,
  placePopupNear,
  el,
  syncMsrLists,
  $,
  COLUMNS,
  CELL_MAX
};

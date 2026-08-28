import * as MsrChoices from "../../lib/msrchoices.js";
import { saveValue, removeValue } from "../../lib/storage.js";
import { STORAGE } from "../../lib/keys.js";
import { showToast } from "../../lib/toast.js";
import { uiStore, setHiddenCols, setMsrLists, getMsrLists } from "./00-store.js";
import { buildHead, load, render } from "./30-grid.js";


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

function updateColsBtn() {
  $("colsBtn").textContent = hideStore().size ? `Columns (${hideStore().size} hidden)` : "Columns";
}

// Max characters shown in a cell before truncating (full text in tooltip).
const CELL_MAX = 60;
function cellShort(text) {
  return text.length > CELL_MAX ? text.slice(0, CELL_MAX).trimEnd() + "…" : text;
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

function placePopupNear(pop, rect, minW, gap = 4) {
  const w = Math.max(rect.width, minW);
  pop.style.width = `${w}px`;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
  let top = rect.bottom + gap;
  if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - pop.offsetHeight - gap);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

$("clearBtn").addEventListener("click", async () => {
  await removeValue(STORAGE.lastData);
  load(null);
  showToast("Pull data cleared");
});

$("colsBtn").addEventListener("click", e => {
  e.stopPropagation();
  const menu = $("colMenu");
  if (menu.classList.contains("hidden")) {
    buildColMenu();
    $("colSearch").value = "";
    setTimeout(() => $("colSearch").focus(), 0);
  }
  menu.classList.toggle("hidden");
});

$("colSearch").addEventListener("input", e => {
  const q = e.target.value.trim().toLowerCase();
  for (const lab of $("colList").children) {
    lab.style.display = !q || lab.textContent.toLowerCase().includes(q) ? "" : "none";
  }
});

function buildColMenu() {
  const list = $("colList");
  list.innerHTML = "";
  for (const [key, label] of COLUMNS) {
    const lab = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !hideStore().has(key);
    cb.addEventListener("change", () => toggleCol(key, cb.checked));
    const span = document.createElement("span");
    span.textContent = label;
    lab.append(cb, span);
    list.appendChild(lab);
  }
}

async function toggleCol(key, show) {
  const hc = hideStore();
  if (!show && COLUMNS.length - hc.size <= 1) {
    setStatus("At least one column must stay visible", true);
    buildColMenu();
    return;
  }
  if (show) hc.delete(key);
  else hc.add(key);
  setHiddenCols(new Set(hc));
  try {
    await saveValue(STORAGE.viewerHiddenCols, [...hc]);
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, true);
  }
  buildHead();
  render();
  updateColsBtn();
}

$("showAllCols").addEventListener("click", async () => {
  setHiddenCols(new Set());
  try {
    await saveValue(STORAGE.viewerHiddenCols, []);
  } catch {}
  $("colMenu").classList.add("hidden");
  buildHead();
  render();
  updateColsBtn();
  setStatus("All columns visible");
});

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
  updateColsBtn,
  cellShort,
  columnOptionList,
  migrateLegacyResolutions,
  setStatus,
  placePopupNear,
  buildColMenu,
  toggleCol,
  el,
  syncMsrLists,
  $,
  COLUMNS,
  CELL_MAX
};

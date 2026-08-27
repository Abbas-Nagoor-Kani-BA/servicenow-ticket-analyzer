import * as MsrChoices from "../../lib/msrchoices.js";
import { buildHead, hasDataRows, load, render, selfPush } from "./30-grid.js.back";


const $ = id => document.getElementById(id);

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
  ["assignTime", "Assign time", "inst", 155],
  ["acknTime", "Ackn time", "inst", 155],
  ["suspendTime", "Suspend time", "inst", 155],
  ["resumeTime", "Resume time", "inst", 155],
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

let hiddenCols = new Set();
chrome.storage.local.get(["viewerHiddenCols"], ({ viewerHiddenCols }) => {
  if (Array.isArray(viewerHiddenCols)) {
    hiddenCols = new Set(viewerHiddenCols.filter(k => COLUMNS.some(c => c[0] === k)));
    updateColsBtn();
    if (hasDataRows() && !document.querySelector("td.edit-input input")) {
      buildHead();
      render();
    }
  }
});

function visibleCols() {
  return COLUMNS.filter(([key]) => !hiddenCols.has(key));
}

function updateColsBtn() {
  $("colsBtn").textContent = hiddenCols.size ? `Columns (${hiddenCols.size} hidden)` : "Columns";
}

// Max characters shown in a cell before truncating (full text in tooltip).
const CELL_MAX = 60;
function cellShort(text) {
  return text.length > CELL_MAX ? text.slice(0, CELL_MAX).trimEnd() + "…" : text;
}

chrome.storage.local.get(["lastData"], ({ lastData }) => load(lastData));

let msrLists = MsrChoices.mergeMsrLists(null);
chrome.storage.local.get(["msrLists"], ({ msrLists: stored }) => {
  msrLists = MsrChoices.mergeMsrLists(stored && stored.lists ? stored.lists : null);
  if (hasDataRows()) {
    buildHead();
    render();
  }
});

function columnOptionList(key, row) {
  if (!row) return null;
  switch (key) {
    case "solutionType": return msrLists.resolution;
    case "rootCause": return MsrChoices.rootCauseFor(msrLists.rootCause, MsrChoices.msrType(row.number));
    case "subCategory": return msrLists.subCategory;
    case "duplicateIncident": return msrLists.duplicate;
    case "assignmentGroup": return msrLists.queue;
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

chrome.runtime.onMessage.addListener(msg => {
  if (msg?.type === "DATA_UPDATED") {
    if (selfPush || document.querySelector("td.edit-input input, .msrPick")) return false;
    chrome.storage.local.get(["lastData", "msrLists"], ({ lastData, msrLists: stored }) => {
      msrLists = MsrChoices.mergeMsrLists(stored && stored.lists ? stored.lists : null);
      load(lastData);
      setStatus("Updated from latest run");
    });
  }
  return false;
});

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
  await chrome.storage.local.remove("lastData");
  load(null);
  setStatus("Cleared");
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
    cb.checked = !hiddenCols.has(key);
    cb.addEventListener("change", () => toggleCol(key, cb.checked));
    const span = document.createElement("span");
    span.textContent = label;
    lab.append(cb, span);
    list.appendChild(lab);
  }
}

async function toggleCol(key, show) {
  if (!show && COLUMNS.length - hiddenCols.size <= 1) {
    setStatus("At least one column must stay visible", true);
    buildColMenu();
    return;
  }
  if (show) hiddenCols.delete(key);
  else hiddenCols.add(key);
  try {
    await chrome.storage.local.set({ viewerHiddenCols: [...hiddenCols] });
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, true);
  }
  buildHead();
  render();
  updateColsBtn();
}

$("showAllCols").addEventListener("click", async () => {
  hiddenCols.clear();
  try {
    await chrome.storage.local.set({ viewerHiddenCols: [] });
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
  $,
  COLUMNS,
  hiddenCols,
  CELL_MAX,
  msrLists
};

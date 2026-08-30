import { detectSnOffsetMs, rowOffsetMs } from "../../core/sntime.ts";
import { extractHeuristic } from "../../core/aiextract.ts";
import { STORAGE } from "../../lib/keys.ts";
import { pad2 } from "../../lib/format.ts";
import { showToast } from "../../lib/toast.ts";
import { $, columnOptionList, migrateLegacyResolutions, setStatus, visibleCols } from "./core.js";
import { DataGrid } from "../../components/data-grid.ts";
import { currentRows, hasDataRows, parseLocalInput } from "./grid-data.js";
import { dataStore, getColWidths, saveColWidths, setColWidths, setSelfPush } from "./store.js";
import { attachSummaryToData, renderSummary, setRowsProvider } from "./summary.js";

function st() { return dataStore.getState(); }

let selHooks = {
  highlight: () => {},
  clearUndo: () => {},
  restorePending: () => {},
  ensureDefault: () => {}
};

function setSelectionHooks(h) { selHooks = { ...selHooks, ...h }; }

function load(d) {
  selHooks.clearUndo();
  const data = d && Array.isArray(d.rows) ? d : null;
  dataStore.setState({ data, sortKey: null, sortDir: 1, snOffsetMs: data ? detectSnOffsetMs(data.rows) : 0 });
  let migrated = 0;
  if (data) {
    autoParse();
    migrated = migrateLegacyResolutions(data.rows);
    if (migrated) persistEdits();
  }
  if (!data || !data.rows.length) {
    $("wrap").classList.add("hidden");
    document.querySelector(".toolbar").classList.add("hidden");
    $("tabs").classList.add("hidden");
    $("summaryWrap").classList.add("hidden");
    $("empty").classList.remove("hidden");
    return;
  }
  $("tabs").classList.remove("hidden");
  if (data.debug && data.debug.ticketsWithAudit === 0) {
    const warn = document.createElement("div");
    warn.style.cssText = "padding:6px 18px;color:#fab387;font-size:12px;";
    warn.textContent =
      "No timeline events found for any pulled ticket. Common causes: (1) the activity feed returned nothing - open a ticket's form in this instance's tab and check its Activity section renders field changes; (2) tickets were never updated through the platform; (3) list_history.do is blocked on this release. Timeline columns stay empty without feed events.";
    $("tabs").before(warn);
  }
  render();
  selHooks.restorePending();
  selHooks.ensureDefault();
  if (attachSummaryToData(data)) scheduleSave();
  renderSummary();
}

function formatWallClock(d) {
  return `${pad2(d.getUTCDate())}-${pad2(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ` +
    `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function fmtInstant(utcIso, row) {
  if (!utcIso) return "";
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return String(utcIso);
  const offsetMs = rowOffsetMs(row, st().snOffsetMs);
  const local = new Date(d.getTime() + offsetMs);
  return formatWallClock(local);
}

let grid = null;

export function initGrid() {
  setRowsProvider(() => currentRows());
  grid = new DataGrid($("wrap"), {}, {
    table: $("tbl"),
    count: $("count"),
    slaBar: $("slaBar"),
    fmtInstant,
    columnOptions: (key, row) => columnOptionList(key, row),
    onSort: (key) => {
      const { sortKey, sortDir } = st();
      if (sortKey === key) dataStore.setState({ sortDir: -sortDir });
      else dataStore.setState({ sortKey: key, sortDir: 1 });
      render();
    },
    onWidthsChange: (widths) => {
      setColWidths(widths);
      saveColWidths();
    },
    afterRender: () => {
      selHooks.highlight();
      renderSummary();
    }
  });
}

function gridState(rows) {
  const { data, sortKey, sortDir } = st();
  return {
    cols: visibleCols(),
    rows,
    total: data ? data.rows.length : 0,
    sortKey,
    sortDir,
    colWidths: getColWidths()
  };
}

/** Rebuilds only the header. render() does this too; this is for callers that
 *  change column visibility and then render separately. */
function buildHead() {
  grid.refreshHead(getColWidths());
}

function resetColWidths() {
  setColWidths({});
  saveColWidths();
  render();
}

function render() {
  grid.render(gridState(currentRows()));
}

function scheduleSave() {
  clearTimeout(st().saveTimer);
  dataStore.setState({ saveTimer: setTimeout(saveData, 350) });
}

async function saveData() {
  const { data, saveTimer } = st();
  if (saveTimer) { clearTimeout(saveTimer); dataStore.setState({ saveTimer: null }); }
  if (!data) return;
  attachSummaryToData(data);
  setSelfPush(true);
  await chrome.storage.local.set({ [STORAGE.lastData]: data });
  setTimeout(() => setSelfPush(false), 300);
  renderSummary();
}

async function persistEdits() {
  const { data } = st();
  if (!data) return;
  attachSummaryToData(data);
  setSelfPush(true);
  try {
    await chrome.storage.local.set({ [STORAGE.lastData]: data });
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, true);
  }
  setTimeout(() => setSelfPush(false), 300);
  renderSummary();
}

function getData() {
  return st().data;
}

function getTotalRows() {
  const data = st().data;
  return data ? data.rows.length : 0;
}

function findRowBySysId(sysId) {
  const data = st().data;
  return data.rows.find(r => String(r.sysId ?? "") === String(sysId ?? ""));
}

function displayedValue(row, key, cls) {
  const v = row[key];
  if (cls === "inst") return fmtInstant(v, row);
  return v === null || v === undefined ? "" : String(v);
}

function autoParse() {
  const data = st().data;
  if (!data || !Array.isArray(data.rows)) return 0;
  let filled = 0, withNotes = 0;
  for (const row of data.rows) {
    if (!(row.closeNotes || "").trim()) continue;
    withNotes++;
    if (row.solutionType && row.rootCause) continue;
    const h = extractHeuristic(row.closeNotes);
    if (h.solutionType || h.rootCause) {
      row.solutionType = row.solutionType || h.solutionType;
      row.rootCause = row.rootCause || h.rootCause;
      const conf = h.confidence;
      if ((h.solutionType && conf?.solutionType !== "high") || (h.rootCause && conf?.rootCause !== "high")) {
        row.parseReview = true;
      }
      filled++;
    }
  }
  if (data.rows.length && !withNotes) {
    setStatus("No close notes / work notes / comments found on these tickets", true);
  } else if (filled) {
    showToast(`Extracted resolution details from ${filled} ticket${filled === 1 ? "" : "s"}`);
  }
  return filled;
}

export {
  load,
  buildHead,
  currentRows,
  fmtInstant,
  render,
  scheduleSave,
  persistEdits,
  saveData,
  parseLocalInput,
  getData,
  getTotalRows,
  hasDataRows,
  findRowBySysId,
  displayedValue,
  autoParse,
  resetColWidths,
  setSelectionHooks
};

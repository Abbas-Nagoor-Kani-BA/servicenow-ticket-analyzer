import { STORAGE } from "../../lib/keys.ts";
import { loadOnce, saveValue } from "../../lib/storage.ts";
import { dataStore } from "./store.ts";
import { buildSummaryDetailsFor } from "./core.ts";
import type { SummaryChangeRow, SummaryIncidentRow } from "../../core/templatexml.ts";

const $ = (id: string): any => document.getElementById(id);

/**
 * Editable narrative fields the user types on the Weekly Summary sheet. Each
 * maps to a target cell ref written by patchSummaryDetailsSheet on export.
 * These are the columns the pull cannot derive.
 */
const NARRATIVE_FIELDS: Array<{ ref: string; label: string; rows: number }> = [
  { ref: "A2", label: "Key highlights & lowlights / ongoing activities", rows: 6 },
  { ref: "A35", label: "Operational Health", rows: 3 }
];

let narrative: Record<string, string> = {};

/** Current typed narrative, keyed by target cell ref. */
export function getSummaryNarrative(): Record<string, string> {
  return { ...narrative };
}

function persist(): void {
  void saveValue(STORAGE.viewerSummaryNarrative, narrative);
}

function serialToDisplay(serial: number | null): string {
  if (serial === null || !Number.isFinite(serial)) return "";
  // Excel serial -> ms: (serial - 25569) * 86400000, epoch 1899-12-30.
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "";
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function renderTableHead(tbl: HTMLTableElement, headers: string[]): void {
  const thead = tbl.tHead;
  if (!thead) return;
  thead.innerHTML = "";
  const tr = document.createElement("tr");
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h;
    tr.appendChild(th);
  }
  thead.appendChild(tr);
}

function fillCells(tr: HTMLTableRowElement, cells: string[]): void {
  for (const c of cells) {
    const td = document.createElement("td");
    if (c) td.textContent = c;
    tr.appendChild(td);
  }
}

function renderChangeTable(tbl: HTMLTableElement, rows: SummaryChangeRow[]): void {
  renderTableHead(tbl, ["Date", "System/Area", "CR Number", "Details"]);
  const tbody = tbl.tBodies[0];
  tbody.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.className = "text-dim";
    td.textContent = "None";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  for (const r of rows) {
    const tr = document.createElement("tr");
    fillCells(tr, [serialToDisplay(r.date), r.systemArea, r.crNumber, r.details]);
    tbody.appendChild(tr);
  }
}

function renderIncidentTable(tbl: HTMLTableElement, rows: SummaryIncidentRow[]): void {
  renderTableHead(tbl, ["Resolution Date", "System/Area", "Incident Number", "Details", "Status", "Root Cause & Resolution"]);
  const tbody = tbl.tBodies[0];
  tbody.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "text-dim";
    td.textContent = "None";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  for (const r of rows) {
    const tr = document.createElement("tr");
    fillCells(tr, [serialToDisplay(r.resolutionDate), r.systemArea, r.incidentNumber, r.details, r.status, r.rootCauseResolution]);
    tbody.appendChild(tr);
  }
}

function renderNarrative(): void {
  const host = $("sdNarrative") as HTMLElement;
  if (!host || host.dataset.built === "1") {
    // Only sync values on re-render; the inputs already exist.
    for (const f of NARRATIVE_FIELDS) {
      const ta = document.getElementById(`sdNarr_${f.ref}`) as HTMLTextAreaElement | null;
      if (ta && ta.value !== (narrative[f.ref] || "")) ta.value = narrative[f.ref] || "";
    }
    return;
  }
  host.innerHTML = "";
  for (const f of NARRATIVE_FIELDS) {
    const label = document.createElement("label");
    label.className = "block text-[11px] text-dim mt-3 mb-1 uppercase tracking-wider";
    label.textContent = f.label;
    const ta = document.createElement("textarea");
    ta.id = `sdNarr_${f.ref}`;
    ta.className = "textarea w-full";
    ta.rows = f.rows;
    ta.value = narrative[f.ref] || "";
    ta.addEventListener("input", () => {
      narrative[f.ref] = ta.value;
      persist();
    });
    host.appendChild(label);
    host.appendChild(ta);
  }
  host.dataset.built = "1";
}

export function renderSummaryDetails(): void {
  const wrap = $("summaryDetailsWrap") as HTMLElement;
  if (!wrap || wrap.classList.contains("hidden")) return;
  const data = dataStore.getState().data;
  const details = buildSummaryDetailsFor(data);
  const keyInc = details.keyIncidents ?? [];
  const impl = details.changesImplemented ?? [];
  const planned = details.changesPlanned ?? [];
  const failedC = details.changesFailed ?? [];
  const changeCount = impl.length + planned.length + failedC.length;
  $("sdMeta").textContent = data && Array.isArray((data as { changeSummaryRows?: unknown[] }).changeSummaryRows)
    ? `${changeCount} change(s) bucketed · ${keyInc.length} key incident(s). Type the narrative fields below; they and the tables export to the Summary sheet.`
    : "No change requests pulled. Enable \u201CPull change requests for Weekly Summary\u201D in the side panel and run a pull. You can still type the narrative fields below.";
  renderNarrative();
  renderIncidentTable($("sdKeyIncTbl"), keyInc);
  renderChangeTable($("sdImplTbl"), impl);
  renderChangeTable($("sdPlannedTbl"), planned);
  renderChangeTable($("sdFailedTbl"), failedC);
}

export function initSummaryDetails(): void {
  void loadOnce<Record<string, string>>(STORAGE.viewerSummaryNarrative, {}).then((n) => {
    narrative = (n && typeof n === "object") ? n : {};
    renderNarrative();
  });
  // Re-render when the tab is shown; summary.ts owns the tab buttons, so hook
  // the click here too (both listeners run; each guards on its own wrap).
  const tab = $("tabSummaryDetails");
  if (tab) tab.addEventListener("click", () => renderSummaryDetails());
}

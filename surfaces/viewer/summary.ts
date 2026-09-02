import { rowOffsetMs } from "../../core/sntime.ts";
import { pad2 } from "../../lib/format.ts";
import { icon } from "../../lib/icons.ts";
import type { SlaSummaryItem } from "../../core/slasummary.ts";
import { buildSlaSummaryFor } from "./core.ts";
import type { ViewerRow, ViewerData } from "./core.ts";
import { dataStore } from "./store.ts";

const $ = (id: string): any => document.getElementById(id);

function panelFmt(utcIso: string, row: ViewerRow): string {
  if (!utcIso) return "";
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return String(utcIso);
  const offsetMs = rowOffsetMs(row, dataStore.getState().snOffsetMs);
  const local = new Date(d.getTime() + offsetMs);
  return `${pad2(local.getUTCDate())}-${pad2(local.getUTCMonth() + 1)}-${local.getUTCFullYear()} ` +
    `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())}`;
}

function attachSummaryToData(data: ViewerData | null | undefined): boolean {
  if (!data || !Array.isArray(data.rows)) return false;
  data.summarySla = buildSlaSummaryFor(data.rows, panelFmt);
  return true;
}

function pct(v: number): string {
  return `${Math.round((v || 0) * 100)}%`;
}

let rowsProvider: (() => ViewerRow[]) | null = null;

function setRowsProvider(fn: () => ViewerRow[]) {
  rowsProvider = fn;
}

function addCell(tr: HTMLTableRowElement, text: unknown, cls?: string, span = 1): HTMLTableCellElement {
  const td = document.createElement("td");
  if (cls) td.className = cls;
  if (span > 1) td.rowSpan = span;
  if (text) td.textContent = String(text);
  tr.appendChild(td);
  return td;
}

function addStackedCell(tr: HTMLTableRowElement, lines: string[], cls?: string, span = 1): HTMLTableCellElement {
  const td = document.createElement("td");
  if (cls) td.className = cls;
  if (span > 1) td.rowSpan = span;
  lines.forEach((line, i) => {
    if (i) td.appendChild(document.createElement("br"));
    td.appendChild(document.createTextNode(line));
  });
  tr.appendChild(td);
  return td;
}

function addTokenCell(tr: HTMLTableRowElement, tokens: Array<{ text: string; bold?: boolean }>, cls?: string): HTMLTableCellElement {
  const td = document.createElement("td");
  if (cls) td.className = cls;
  let first = true;
  for (const tok of tokens) {
    if (!first) td.appendChild(document.createElement("br"));
    first = false;
    if (tok.bold) {
      const b = document.createElement("strong");
      b.textContent = tok.text;
      td.appendChild(b);
    } else {
      td.appendChild(document.createTextNode(tok.text));
    }
  }
  tr.appendChild(td);
  return td;
}

function statusCls(status: string): string {
  return "status " + (status === "GREEN" ? "green" : status === "AMBER" ? "amber" : "red");
}

function targetCls(item: SlaSummaryItem): string {
  if (item.metric !== "Time to Resolve") return "";
  if (item.category.startsWith("Severity 1")) return "target";
  if (item.category.startsWith("Severity 2")) return "target green-target";
  return "";
}

function incidentRowCount(items: SlaSummaryItem[], item: SlaSummaryItem): number {
  return items.filter(x => x.metric === item.metric).length;
}

function categoryRunCount(items: SlaSummaryItem[], item: SlaSummaryItem): number {
  return items.filter(x => x.metric === item.metric && x.category === item.category).length;
}

function buildIncidentTable(tbody: HTMLTableSectionElement, incident: SlaSummaryItem[]): void {
  let prevMetric: string | null = null;
  let prevCat: string | null = null;
  for (const it of incident) {
    const tr = document.createElement("tr");
    tr.dataset.sla = String(it.sla ?? "");
    if (it.metric !== prevMetric) {
      addCell(tr, it.metric, "spanned", incidentRowCount(incident, it));
      addCell(tr, it.ticketType, "spanned", incidentRowCount(incident, it));
      prevMetric = it.metric;
    }
    if (it.category !== prevCat) {
      addCell(tr, it.category, "spanned", categoryRunCount(incident, it));
      prevCat = it.category;
    }
    addCell(tr, it.sla, "sla");
    addCell(tr, pct(it.target), targetCls(it));
    addCell(tr, pct(it.actual), "actual");
    addCell(tr, String(it.count), "count");
    addCell(tr, String(it.total), "total");
    addCell(tr, it.status, statusCls(it.status));
    tbody.appendChild(tr);
  }
}

function stackedMetric(item: SlaSummaryItem): string[] {
  if (item.metric === "Known Error Logging") return ["Known Error", "Logging"];
  if (item.metric.startsWith("Reoccuring")) return ["Reoccuring", "Incident -", "Problem creation"];
  return [item.metric];
}

function stackedCategory(item: SlaSummaryItem): string[] {
  if (item.category === "All other priorities except High") return ["All other priorities except", "High"];
  return [item.category];
}

function probSlaTokens(item: SlaSummaryItem): Array<{ text: string; bold?: boolean }> {
  const days = (String(item.sla).match(/within (\d+) working days/i) || [])[1];
  if (item.metric === "Known Error Logging") {
    return [
      { text: "Plan of action detailing options," },
      { text: "dependencies, risks and timescales for" },
      { text: "fixing the problem to be available within" },
      { text: `${days} working days`, bold: true }
    ];
  }
  return [{ text: "Problem creation for reoccuring problems" }];
}

function buildProblemTable(tbody: HTMLTableSectionElement, problems: SlaSummaryItem[]): void {
  for (const it of problems) {
    const tr = document.createElement("tr");
    tr.dataset.sla = String(it.sla ?? "");
    addStackedCell(tr, stackedMetric(it), "slaMetric");
    addCell(tr, it.ticketType);
    addStackedCell(tr, stackedCategory(it), "slaCat");
    addTokenCell(tr, probSlaTokens(it), "sla");
    addCell(tr, pct(it.target), "target");
    addCell(tr, "");
    addCell(tr, String(it.count), "count");
    addCell(tr, String(it.total), "total");
    addCell(tr, "");
    tbody.appendChild(tr);
  }
}

function buildTableHead(thead: HTMLTableSectionElement | null, headers: string[]): void {
  if (!thead) return;
  thead.innerHTML = "";
  const headTr = document.createElement("tr");
  for (const h of headers) {
    const th = document.createElement("th");
    th.innerHTML = h;
    headTr.appendChild(th);
  }
  thead.appendChild(headTr);
}

function renderSummary(): void {
  if ($("summaryWrap").classList.contains("hidden")) return;
  const { data } = dataStore.getState();
  if (!data || !data.rows || !data.rows.length) {
    $("summaryWrap").classList.add("hidden");
    return;
  }
  const rows = rowsProvider ? rowsProvider() : data.rows;
  const s = buildSlaSummaryFor(rows, panelFmt);
  let meta = `Computed ${s.computedAt.slice(0, 16).replace("T", " ")} · incidents by severity — ` +
    `P1 ${s.incidentTotals[1]}, P2 ${s.incidentTotals[2]}, P3 ${s.incidentTotals[3]}, P4 ${s.incidentTotals[4]}`;
  if (rows.length !== data.rows.length) {
    meta += ` · showing ${rows.length} of ${data.rows.length} tickets (search filter)`;
  }
  $("sumMeta").textContent = meta;
  const incTbl = $("sumIncTbl") as HTMLTableElement;
  const probTbl = $("sumProbTbl") as HTMLTableElement;
  buildTableHead(incTbl.tHead, [
    "Service Metric", "Ticket Type", "Category", "SLA", "Target", "Actual",
    "Count of<br>Incidents", "Total<br>Incidents", "Actual<br>Status"
  ]);
  buildTableHead(probTbl.tHead, [
    "Service Metric", "Ticket Type", "Category", "SLA", "Target", "Actual",
    "Count of<br>Problems", "Total<br>Problems", "Actual<br>Status"
  ]);
  incTbl.tBodies[0].innerHTML = "";
  probTbl.tBodies[0].innerHTML = "";
  buildIncidentTable(incTbl.tBodies[0], s.items.filter(i => i.ticketType === "Incident"));
  buildProblemTable(probTbl.tBodies[0], s.items.filter(i => i.ticketType === "Problem"));
}

function setTab(ticketsOn: boolean): void {
  $("tabTickets").classList.toggle("on", ticketsOn);
  $("tabSummary").classList.toggle("on", !ticketsOn);
  $("tabTickets").setAttribute("aria-selected", ticketsOn ? "true" : "false");
  $("tabSummary").setAttribute("aria-selected", ticketsOn ? "false" : "true");
}

function showTickets(): void {
  setTab(true);
  $("wrap").classList.remove("hidden");
  $("summaryWrap").classList.add("hidden");
}

function showSummary(): void {
  setTab(false);
  $("wrap").classList.add("hidden");
  $("summaryWrap").classList.remove("hidden");
  renderSummary();
}

export function initSummary(): void {
  // Replace the tab glyph span with a Lucide icon.
  const ticketsGlyph = $("tabTickets").querySelector(".g");
  if (ticketsGlyph && ticketsGlyph.parentNode) ticketsGlyph.parentNode.replaceChild(icon("list", "g") as unknown as Node, ticketsGlyph);
  const summaryGlyph = $("tabSummary").querySelector(".g");
  if (summaryGlyph && summaryGlyph.parentNode) summaryGlyph.parentNode.replaceChild(icon("chart-line", "g") as unknown as Node, summaryGlyph);

  $("tabTickets").addEventListener("click", () => showTickets());
  $("tabSummary").addEventListener("click", () => showSummary());

  document.addEventListener("keydown", e => {
    const t = e.target;
    if (t instanceof HTMLElement &&
        (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    if (e.key === "1") { e.preventDefault(); showTickets(); }
    else if (e.key === "2") { e.preventDefault(); showSummary(); }
    else if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) showTickets();
      else showSummary();
    }
  });
}

export { attachSummaryToData, renderSummary, setRowsProvider };
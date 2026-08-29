import { Component, el } from "./component.ts";
import type { ComponentProps } from "./component.ts";
import { cellShort } from "../lib/markup.js";
import { setTip } from "../lib/tooltip.js";
import { buildReport } from "../analysis/report.js";

/** [key, label, cell class, default width] — matches COLUMNS in viewer/js/00-core.js. */
export type GridColumn = readonly [string, string, string, number];

export type GridRow = Record<string, any>;

export type BreachCounts = { r: number; m: number; rm: number };

export type DataGridState = {
  cols: GridColumn[];
  rows: GridRow[];
  /** Total rows before filtering, shown in the footer. */
  total: number;
  sortKey: string | null;
  sortDir: number;
  colWidths: Record<string, number>;
};

export type DataGridDeps = {
  /** The table element. */
  table: HTMLTableElement;
  /** Footer count, a sibling of the table rather than a child. */
  count: HTMLElement;
  /** SLA legend, also a sibling. */
  slaBar: HTMLElement;
  /** Instance-clock formatter; the grid must not own timezone logic. */
  fmtInstant: (utcIso: string, row: GridRow) => string;
  /** Option list for a cell, or null when the column is free text. */
  columnOptions: (key: string, row: GridRow) => string[] | null;
  onSort: (key: string) => void;
  onWidthsChange: (widths: Record<string, number>) => void;
  /** Runs after the rows are in the DOM, e.g. to restore the selection. */
  afterRender: () => void;
};

export type DataGridRefs = {
  table: HTMLTableElement;
  count: HTMLElement;
  slaBar: HTMLElement;
};

const MIN_COL_W = 40;

/**
 * Transient column-resize drag state.
 *
 * Deliberately module-level rather than component state: it changes on every
 * pointermove, and routing that through setState would re-render the whole grid
 * mid-drag.
 */
let resizeState: { key: string; colEl: HTMLElement; startX: number; startW: number } | null = null;

/**
 * The viewer's ticket table: header, rows and footer.
 *
 * Owns the table DOM and the per-row cell decorations — SLA breach markers,
 * low-confidence parse flags, off-list MSR values — which were previously built
 * inline in viewer/js/30-grid.js alongside the save pipeline and the data
 * store. That module now owns the data and delegates the DOM here.
 *
 * `patch()` rebuilds the header, rows and footer together because all three
 * depend on the visible columns. It refuses to run while a cell editor is open,
 * which is what keeps an in-progress edit from being torn out from under the
 * user.
 */
export class DataGrid extends Component<DataGridState, ComponentProps, DataGridDeps> {
  protected declare refs: DataGridRefs;

  protected initialState(): DataGridState {
    return { cols: [], rows: [], total: 0, sortKey: null, sortDir: 1, colWidths: {} };
  }

  protected build(): void {
    // The table, the row count and the SLA legend are siblings in the page,
    // not nested, so they arrive as dependencies rather than via q().
    this.refs.table = this.deps.table;
    this.refs.count = this.deps.count;
    this.refs.slaBar = this.deps.slaBar;
  }

  protected patch(next: DataGridState, prev: DataGridState | null): void {
    if (!prev) return;
    if (document.querySelector("td.edit-input")) return;

    this.buildHead(next);
    const { breachCounts, typeCounts } = this.buildRows(next);
    this.updateFooter(next, typeCounts, breachCounts);
    this.deps.afterRender();
  }

  /** Full render. Callers pass the complete view state. */
  render(state: DataGridState): void {
    this.setState(state);
  }

  /**
   * Rebuilds only the header, e.g. after the column widths change.
   *
   * Takes the widths explicitly: reading them from state would use whatever
   * the last full render saw, which is stale the moment the caller changes
   * a width. Does not touch the rows.
   */
  refreshHead(widths: Record<string, number>): void {
    this.buildHead({ ...this.getState(), colWidths: widths });
  }

  /**
   * Takes the widths explicitly rather than reading state, so buildHead can
   * be called with an override (see refreshHead).
   */
  protected colWidthOf(widths: Record<string, number>, key: string, defaultW: number): number {
    const w = widths[key];
    return Number.isFinite(w) && w > 0 ? w : defaultW || 170;
  }

  protected buildHead(state: DataGridState): void {
    const table = this.refs.table;

    let colgroup = table.querySelector("colgroup");
    if (!colgroup) {
      colgroup = document.createElement("colgroup");
      table.prepend(colgroup);
    }
    colgroup.innerHTML = "";

    const colEls: HTMLElement[] = [];
    for (const col of state.cols) {
      const colEl = document.createElement("col");
      colEl.style.width = `${this.colWidthOf(state.colWidths, col[0], col[3])}px`;
      colgroup.appendChild(colEl);
      colEls.push(colEl);
    }

    const thead = table.tHead;
    if (!thead) return;
    thead.innerHTML = "";

    const tr = document.createElement("tr");
    state.cols.forEach(([key, label], i) => {
      const th = document.createElement("th");
      th.textContent = label;

      const handle = el("span", "colResize");
      handle.addEventListener("pointerdown", (e) => {
        const pe = e as PointerEvent;
        pe.preventDefault();
        pe.stopPropagation();
        handle.classList.add("active");
        resizeState = {
          key,
          colEl: colEls[i],
          startX: pe.clientX,
          startW: this.colWidthOf(state.colWidths, key, state.cols[i][3])
        };
        try {
          handle.setPointerCapture(pe.pointerId);
        } catch {
          /* pointer capture is best-effort */
        }
      });
      handle.addEventListener("pointermove", (e) => {
        const pe = e as PointerEvent;
        if (!resizeState || resizeState.key !== key) return;
        const w = Math.max(MIN_COL_W, resizeState.startW + (pe.clientX - resizeState.startX));
        resizeState.colEl.style.width = `${w}px`;
      });
      handle.addEventListener("pointerup", () => {
        if (!resizeState || resizeState.key !== key) return;
        const width = parseFloat(resizeState.colEl.style.width) || resizeState.startW;
        resizeState = null;
        handle.classList.remove("active");
        this.deps.onWidthsChange({ ...this.getState().colWidths, [key]: width });
      });
      handle.addEventListener("pointercancel", () => {
        if (resizeState && resizeState.key === key) resizeState = null;
        handle.classList.remove("active");
      });
      handle.addEventListener("click", (e) => e.stopPropagation());
      th.appendChild(handle);

      if (key === state.sortKey) th.classList.add("sorted", ...(state.sortDir === -1 ? ["desc"] : []));
      th.addEventListener("click", () => this.deps.onSort(key));

      tr.appendChild(th);
    });

    thead.appendChild(tr);
  }

  protected buildRows(state: DataGridState): { breachCounts: BreachCounts; typeCounts: Record<string, number> } {
    const frag = document.createDocumentFragment();
    const breachCounts: BreachCounts = { r: 0, m: 0, rm: 0 };
    const typeCounts: Record<string, number> = {};

    for (const row of state.rows) {
      const tr = document.createElement("tr");
      tr.dataset.sysId = String(row.sysId ?? "");
      const rep = buildReport(row, this.deps.fmtInstant) as Record<string, any>;
      const num = String(row.number ?? "");
      if (num) typeCounts[rep.type || "Other"] = (typeCounts[rep.type || "Other"] || 0) + 1;

      for (const [key, , cls] of state.cols) {
        tr.appendChild(this.buildCell(row, rep, key, cls, breachCounts));
      }
      frag.appendChild(tr);
    }

    const tbody = this.refs.table.tBodies[0];
    if (tbody) {
      tbody.innerHTML = "";
      tbody.appendChild(frag);
    }

    return { breachCounts, typeCounts };
  }

  protected buildCell(
    row: GridRow,
    rep: Record<string, any>,
    key: string,
    cls: string,
    breachCounts: BreachCounts
  ): HTMLElement {
    const td = document.createElement("td");
    if (cls) td.className = cls;

    let v: unknown;
    if (key.startsWith("rep:")) {
      v = rep[key.slice(4)] ?? "";
    } else {
      if (key !== "number") td.classList.add("editable");
      else td.classList.add("numLink");
      v = row[key];
      if (cls === "inst") v = this.deps.fmtInstant(v as string, row);
      if ((cls === "time" || cls === "inst") && !v) td.classList.add("empty-time");
    }

    const text = v === null || v === undefined ? "" : String(v);
    td.textContent = cls ? text : cellShort(text);
    setTip(td, text ? `${text}${td.classList.contains("editable") ? "\n— double-click to edit" : ""}` : "");

    if (key === "number" && text.startsWith("INC")) {
      const stateLabel = String(row.state ?? "").toLowerCase();
      if (stateLabel.startsWith("close") || stateLabel.startsWith("resolv")) {
        const breach = rep.slaBreach;
        if (breach) {
          td.classList.add("sla-breach-" + String(breach).toLowerCase());
          for (const ch of String(breach)) {
            const k = ch.toLowerCase();
            if (k in breachCounts) breachCounts[k as keyof BreachCounts]++;
          }
          const labels = [];
          if (String(breach).includes("R")) labels.push("Response SLA");
          if (String(breach).includes("M")) labels.push("Resolution SLA");
          setTip(td, `⚠ SLA breached — ${labels.join(" & ")}\n\n${td.getAttribute("data-tip") ?? ""}`, "tip-warn");
        }
      }
    }

    if (row.parseReview && (key === "solutionType" || key === "rootCause") && text) {
      td.classList.add("review");
      setTip(td, `⚠ Low-confidence parse — please verify\n\n${td.getAttribute("data-tip") ?? ""}`, "tip-warn");
    }

    const options = td.classList.contains("editable") && text ? this.deps.columnOptions(key, row) : null;
    if (options && options.length && !options.some((o) => String(o).toLowerCase() === text.toLowerCase())) {
      td.classList.add("offlist");
      setTip(td, `Value not in the MSR option list\n\n${td.getAttribute("data-tip") ?? ""}`, "tip-warn");
    }

    return td;
  }

  protected updateFooter(
    state: DataGridState,
    typeCounts: Record<string, number>,
    breachCounts: BreachCounts
  ): void {
    this.refs.count.textContent = `${state.rows.length} / ${state.total} tickets`;

    const parts: string[] = [];
    for (const t of Object.keys(typeCounts).sort()) parts.push(`<b>${typeCounts[t]}</b> ${t}`);

    const breachParts: string[] = [];
    if (breachCounts.rm) breachParts.push(`<span class="slaDot rm"></span>${breachCounts.rm} both SLAs`);
    if (breachCounts.r) breachParts.push(`<span class="slaDot r"></span>${breachCounts.r} response SLA`);
    if (breachCounts.m) breachParts.push(`<span class="slaDot m"></span>${breachCounts.m} resolution SLA`);
    if (breachParts.length) parts.push("SLA breached: " + breachParts.join(" · "));

    if (parts.length) {
      this.refs.slaBar.innerHTML = parts.join(" · ");
      this.refs.slaBar.classList.remove("hidden");
    } else {
      this.refs.slaBar.classList.add("hidden");
    }
  }
}

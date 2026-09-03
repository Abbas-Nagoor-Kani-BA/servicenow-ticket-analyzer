import { $, visibleCols, COLUMNS } from "./core.ts";
import { render, reportCellFocus } from "./grid.ts";
import { anyOverlayOpen, getSelFocus, movePage, moveSel, moveToRowFirstLast, setSelPoint } from "./selection.ts";
import { getCalclensMode } from "./calclens-state.ts";
import { setDisplayValueResolver } from "./grid-data.ts";
import { exportSvc } from "./exporter.ts";
import { setSearchColumn, setSearchMode, setCaseSensitive } from "./search-state.ts";
import type { SearchMode } from "./search-state.ts";

function hitTestTd(e: MouseEvent | PointerEvent): HTMLElement | null {
  if (typeof document.elementFromPoint === "function" && e.clientX != null) {
    const byHit = document.elementFromPoint(e.clientX, e.clientY);
    if (byHit && byHit.closest) {
      const td = byHit.closest("td");
      if (td) return td;
    }
  }
  const t = e.target as HTMLElement | null;
  return t && t.closest ? t.closest("td") : null;
}

/** Report the current selection focus to the Calclens panel (inspect mode only). */
function reportFocus(): void {
  if (!getCalclensMode()) return;
  const f = getSelFocus();
  if (!f) return;
  reportCellFocus({ sysId: f.sysId, key: f.key });
}

export function initInteractions(): void {
  // Single-cell selection: clicking any cell sets the focus point used by
  // Calclens (and highlighted in the grid). No range selection, no drag.
  $("tbl").addEventListener("click", (e: MouseEvent) => {
    const td = hitTestTd(e);
    if (!td || e.button !== 0) return;
    const tr = td.parentElement;
    if (!tr) return;
    const cols = visibleCols();
    const ci = [...tr.children].indexOf(td);
    if (ci < 0 || ci >= cols.length) return;
    setSelPoint(tr.dataset.sysId ?? "", cols[ci][0], false);
    reportFocus();
  });

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    const t = e.target;
    if (t instanceof HTMLElement &&
        (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
      return;
    }
    if (anyOverlayOpen()) return;
    let moved = false;
    switch (e.key) {
      case "ArrowDown": e.preventDefault(); moveSel(1, 0, e.shiftKey); moved = true; break;
      case "ArrowUp": e.preventDefault(); moveSel(-1, 0, e.shiftKey); moved = true; break;
      case "ArrowLeft": e.preventDefault(); moveSel(0, -1, e.shiftKey); moved = true; break;
      case "ArrowRight": e.preventDefault(); moveSel(0, 1, e.shiftKey); moved = true; break;
      case "Home": e.preventDefault(); moveToRowFirstLast(e.shiftKey, "first"); moved = true; break;
      case "End": e.preventDefault(); moveToRowFirstLast(e.shiftKey, "last"); moved = true; break;
      case "PageDown": e.preventDefault(); movePage(1, e.shiftKey); moved = true; break;
      case "PageUp": e.preventDefault(); movePage(-1, e.shiftKey); moved = true; break;
      case "Tab": if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); moveSel(0, e.shiftKey ? -1 : 1, false); moved = true; } break;
    }
    if (moved) reportFocus();
  });

  $("search").addEventListener("input", render);
  initSearchControls();
}

/**
 * Wires the search column dropdown, match-mode dropdown and case toggle buttons.
 * The matcher runs against each column's displayed/export value (injected here
 * from exportSvc.cellValue) so search results line up with what copy and export
 * emit — both already operate on the filtered currentRows().
 */
function initSearchControls(): void {
  // Match against the displayed/exported value, not the raw row field.
  setDisplayValueResolver((row, key, cls) => exportSvc.cellValue(row, key, cls));

  const colSel = $("searchColumn") as HTMLSelectElement;
  if (colSel && !colSel.options.length) {
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "All columns";
    colSel.appendChild(all);
    for (const [key, label] of COLUMNS) {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = label;
      colSel.appendChild(opt);
    }
  }
  colSel?.addEventListener("change", () => { setSearchColumn(colSel.value); render(); });

  const modeSel = $("searchMode") as HTMLSelectElement;
  modeSel?.addEventListener("change", () => { setSearchMode(modeSel.value as SearchMode); render(); });

  const insensitive = $("searchCaseInsensitive");
  const sensitive = $("searchCaseSensitive");
  const setCase = (on: boolean) => {
    setCaseSensitive(on);
    sensitive?.classList.toggle("active", on);
    insensitive?.classList.toggle("active", !on);
    render();
  };
  insensitive?.addEventListener("click", () => setCase(false));
  sensitive?.addEventListener("click", () => setCase(true));
}
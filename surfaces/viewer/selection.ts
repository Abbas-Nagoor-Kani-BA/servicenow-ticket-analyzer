import { $, columnOptionList, visibleCols } from "./core.ts";
import type { ViewerRow, ViewerCol } from "./core.ts";
import { showToast } from "../../lib/toast.ts";
import { currentRows, hasDataRows, parseLocalInput } from "./grid-data.ts";
import { cellValue, tsvCell } from "./clipboard.ts";
import { render, scheduleSave, setSelectionHooks } from "./grid.ts";
import { copyText } from "./shared.ts";
import { selStore, saveSel } from "./store.ts";
import { buildFillGrid, originRowValues, parseClipboardBlock, storedValue } from "./paste.ts";

type Bounds = { rows: ViewerRow[]; cols: ViewerCol[]; lo: number; hi: number; lc: number; hc: number };
type UndoEntry = { row: ViewerRow; key: string; old: unknown };
let lastCopy: { values: unknown[][]; rowCount: number; colCount: number } | null = null;

setSelectionHooks({
  highlight: applySelHighlight,
  clearUndo,
  restorePending: restorePendingSel,
  ensureDefault: ensureDefaultSelection
});

function sel() { return selStore.getState(); }

function restorePendingSel(): void {
  const { pending } = sel();
  if (!pending || !hasDataRows()) return;
  const rows = currentRows();
  const cols = visibleCols();
  const ri = rowIdxOf(pending.f.sysId, rows);
  const ci = colIdxOf(pending.f.key, cols);
  if (ri < 0 || ci < 0) {
    selStore.setState({ pending: null });
    return;
  }
  selStore.setState({
    anchor: { ...pending.a },
    focus: { ...pending.f },
    pending: null
  });
  applySelHighlight();
  scrollSelIntoView();
}

function ensureDefaultSelection(): void {
  if (hasDataRows() && !sel().focus && !sel().pending) moveSel(0, 0, false);
}

function rowIdxOf(sysId: unknown, rows: ViewerRow[]): number {
  return rows.findIndex(r => String(r.sysId ?? "") === String(sysId ?? ""));
}
function colIdxOf(key: string, cols: ViewerCol[]): number {
  return cols.findIndex(c => c[0] === key);
}

function hasSelection(): boolean {
  return !!(sel().anchor || sel().focus);
}

async function clearSelection(): Promise<void> {
  selStore.setState({ anchor: null, focus: null });
  await saveSel();
  applySelHighlight();
}

function selectionBounds(): Bounds | null {
  const { anchor, focus } = sel();
  if (!anchor || !focus || !hasDataRows()) return null;
  const rows = currentRows();
  const cols = visibleCols();
  const r1 = rowIdxOf(anchor.sysId, rows);
  const r2 = rowIdxOf(focus.sysId, rows);
  const c1 = colIdxOf(anchor.key, cols);
  const c2 = colIdxOf(focus.key, cols);
  if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) return null;
  return {
    rows, cols,
    lo: Math.min(r1, r2), hi: Math.max(r1, r2),
    lc: Math.min(c1, c2), hc: Math.max(c1, c2)
  };
}

async function setSelPoint(sysId: string, key: string, extend: boolean): Promise<void> {
  const { anchor } = sel();
  const next = {
    anchor: (!extend || !anchor) ? { sysId, key } : anchor,
    focus: { sysId, key } as { sysId: string; key: string }
  };
  selStore.setState(next);
  await saveSel();
  applySelHighlight();
}

function moveSel(dr: number, dc: number, extend: boolean): void {
  const rows = currentRows();
  const cols = visibleCols();
  if (!rows.length || !cols.length) return;
  let ri = 0, ci = 0;
  const focus = sel().focus;
  if (focus) {
    ri = rowIdxOf(focus.sysId, rows);
    ci = colIdxOf(focus.key, cols);
    if (ri < 0 || ci < 0) { ri = 0; ci = 0; }
  }
  ri = Math.min(rows.length - 1, Math.max(0, ri + dr));
  ci = Math.min(cols.length - 1, Math.max(0, ci + dc));
  setSelPoint(String(rows[ri].sysId ?? ""), cols[ci][0], extend).then(() => scrollSelIntoView());
}

function moveToRowFirstLast(extend: boolean, which: "first" | "last"): void {
  const rows = currentRows();
  const cols = visibleCols();
  if (!rows.length || !cols.length) return;
  const focus = sel().focus;
  let ri = 0;
  if (focus) {
    ri = rowIdxOf(focus.sysId, rows);
    if (ri < 0) ri = 0;
  }
  const ci = which === "first" ? 0 : cols.length - 1;
  setSelPoint(String(rows[ri].sysId ?? ""), cols[ci][0], extend).then(() => scrollSelIntoView());
}

function movePage(dr: number, extend: boolean): void {
  const rows = currentRows();
  const cols = visibleCols();
  if (!rows.length || !cols.length) return;
  const focus = sel().focus;
  let ri = 0, ci = 0;
  if (focus) {
    ri = rowIdxOf(focus.sysId, rows);
    ci = colIdxOf(focus.key, cols);
    if (ri < 0 || ci < 0) { ri = 0; ci = 0; }
  }
  let page = 20;
  const rowEl = $("tbl").tBodies[0].rows[ri];
  const rowH = rowEl ? rowEl.offsetHeight : 24;
  const wrapH = $("wrap").clientHeight;
  if (rowH > 0 && wrapH > 0) page = Math.max(1, Math.floor((wrapH - 40) / rowH));
  ri = Math.min(rows.length - 1, Math.max(0, ri + dr * page));
  setSelPoint(String(rows[ri].sysId ?? ""), cols[ci][0], extend).then(() => scrollSelIntoView());
}

function applySelHighlight(): void {
  for (const tdEl of sel().prev) {
    tdEl.classList.remove("sel", "selr");
    tdEl.style.boxShadow = "";
  }
  selStore.setState({ prev: [] });
  const b = selectionBounds();
  positionFillHandle();
  if (!b) return;
  const focus = sel().focus;
  const want = new Set(b.rows.slice(b.lo, b.hi + 1).map(r => String(r.sysId ?? "")));
  const topSysId = String(b.rows[b.lo].sysId ?? "");
  const bottomSysId = String(b.rows[b.hi].sysId ?? "");
  const focusSysId = focus ? String(focus.sysId) : "";
  const focusKey = focus ? focus.key : "";
  const EDGE = "inset 0 0 0 1px #89b4fa";
  const tbody = $("tbl").tBodies[0];
  const prev: HTMLElement[] = [];
  for (const tr of tbody.rows) {
    if (!want.has(String(tr.dataset.sysId ?? ""))) continue;
    const isTop = String(tr.dataset.sysId ?? "") === topSysId;
    const isBottom = String(tr.dataset.sysId ?? "") === bottomSysId;
    [...tr.children as HTMLCollectionOf<HTMLElement>].forEach((tdEl: HTMLElement, ci: number) => {
      if (ci < b.lc || ci > b.hc) return;
      tdEl.classList.add("selr");
      const edges: string[] = [];
      if (isTop) edges.push("inset 0 2px 0 #89b4fa");
      if (isBottom) edges.push("inset 0 -2px 0 #89b4fa");
      if (ci === b.lc) edges.push("inset 2px 0 0 #89b4fa");
      if (ci === b.hc) edges.push("inset -2px 0 0 #89b4fa");
      const isFocus = String(tr.dataset.sysId ?? "") === focusSysId && b.cols[ci][0] === focusKey;
      tdEl.style.boxShadow = isFocus
        ? "inset 0 0 0 2px #89b4fa"
        : (edges.length ? [...edges, EDGE].join(", ") : "");
      prev.push(tdEl);
    });
  }
  selStore.setState({ prev });
}

function positionFillHandle(): void {
  const h = $("fillHandle");
  if (!h) return;
  const focus = sel().focus;
  const td = selectedTd();
  if (!focus || !td) { h.classList.add("hidden"); return; }
  const wrapRect = $("wrap").getBoundingClientRect();
  const r = td.getBoundingClientRect();
  h.style.left = `${Math.max(0, r.right - wrapRect.left - 7)}px`;
  h.style.top = `${Math.max(0, r.bottom - wrapRect.top - 7)}px`;
  h.classList.remove("hidden");
}

function scrollSelIntoView(): void {
  const focus = sel().focus;
  if (!focus) return;
  const tr = $("tbl").tBodies[0].querySelector(`tr[data-sys-id="${CSS.escape(focus.sysId)}"]`);
  if (!tr) return;
  const cols = visibleCols();
  const ci = colIdxOf(focus.key, cols);
  const td = tr.children[ci];
  if (td) td.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function selectedTd(): HTMLElement | null {
  const focus = sel().focus;
  if (!focus) return null;
  const tr = $("tbl").tBodies[0].querySelector(`tr[data-sys-id="${CSS.escape(focus.sysId)}"]`);
  if (!tr) return null;
  const ci = colIdxOf(focus.key, visibleCols());
  return ci >= 0 ? tr.children[ci] as HTMLElement : null;
}

function rangeTsv(): { text: string; rowCount: number; colCount: number } | null {
  const b = selectionBounds();
  if (!b) return null;
  const lines = b.rows.slice(b.lo, b.hi + 1).map(row =>
    b.cols.slice(b.lc, b.hc + 1).map(c => tsvCell(cellValue(row, c[0], c[2]))).join("\t")
  );
  return { text: lines.join("\n"), rowCount: b.hi - b.lo + 1, colCount: b.hc - b.lc + 1 };
}

const UNDO_MAX = 20;
let undoStack: UndoEntry[][] = [];

function pushUndo(snapshot: UndoEntry[]): void {
  undoStack.push(snapshot);
  if (undoStack.length > UNDO_MAX) undoStack.shift();
}

function clearUndo(): void {
  undoStack = [];
}

function undoLast(): void {
  const op = undoStack.pop();
  if (!op) { showToast("Nothing to undo", "info"); return; }
  for (const { row, key, old } of op) row[key] = old;
  scheduleSave();
  render();
  applySelHighlight();
  showToast(`Undid paste (${op.length} cell${op.length === 1 ? "" : "s"})`);
}

function copySelectedRange(): void {
  const b = selectionBounds();
  if (!b) return;
  const out = rangeTsv();
  if (!out) return;
  const values = b.rows.slice(b.lo, b.hi + 1).map(row =>
    b.cols.slice(b.lc, b.hc + 1).map(([key]) => row[key])
  );
  lastCopy = { values, rowCount: values.length, colCount: values[0] ? values[0].length : 0 };
  copyText(out.text)
    .then(() => showToast(`Copied ${out.rowCount} row${out.rowCount === 1 ? "" : "s"} to clipboard`))
    .catch(() => showToast("Copy failed", "error"));
}

function readClipboardText(): Promise<string | null> {
  return new Promise(resolve => {
    if (typeof navigator !== "undefined" && navigator.clipboard &&
        typeof navigator.clipboard.readText === "function") {
      navigator.clipboard.readText().then(resolve).catch(() => resolve(null));
      return;
    }
    resolve(null);
  });
}

async function handlePaste(): Promise<void> {
  if (!hasSelection() || !selectionBounds()) return;
  let fill: string[][] | null = null;
  let text: string | null = null;
  try { text = await readClipboardText(); } catch { text = null; }
  if (text) {
    const grid = parseClipboardBlock(text);
    if (grid && grid.length) fill = grid;
  }
  if (!fill && lastCopy && lastCopy.values) fill = lastCopy.values as string[][];
  if (!fill && text !== null && text !== "") fill = [[text]];
  if (!fill) { showToast("Clipboard empty", "info"); return; }
  pasteIntoSelection(fill);
}

function writeFill(rows: ViewerRow[], cols: ViewerCol[], lo: number, hi: number, lc: number, hc: number, fillSource: string[][]): { touched: number; skipped: number } {
  const tr = hi - lo + 1;
  const tc = hc - lc + 1;
  const fill = buildFillGrid(fillSource, tr, tc);
  const deps = { parseLocal: parseLocalInput, listFor: columnOptionList };
  let touched = 0, skipped = 0;
  const snapshot: UndoEntry[] = [];
  for (let r = 0; r < tr; r++) {
    for (let c = 0; c < tc; c++) {
      const key = cols[lc + c][0];
      if (!key || key === "number" || key.startsWith("rep:") || key.startsWith("dur:")) { skipped++; continue; }
      const row = rows[lo + r];
      snapshot.push({ row, key, old: row[key] });
      row[key] = storedValue(fill[r][c], key, cols[lc + c][2], row, deps);
      touched++;
    }
  }
  if (touched) {
    pushUndo(snapshot);
    scheduleSave();
    render();
    applySelHighlight();
  }
  const part = touched ? `Pasted ${touched} cell${touched === 1 ? "" : "s"}` : "Nothing to paste";
  const skip = skipped ? ` (${skipped} skipped)` : "";
  showToast(part + skip);
  return { touched, skipped };
}

function pasteIntoSelection(fillSource: string[][]): { touched: number; skipped: number } {
  const b = selectionBounds();
  if (!b) return { touched: 0, skipped: 0 };
  return writeFill(b.rows, b.cols, b.lo, b.hi, b.lc, b.hc, fillSource);
}

function fillFromSelectionOrigin(dragBounds: Bounds): void {
  const b = dragBounds;
  if (!b) return;
  const srcRow = originRowValues(b.rows, b.cols, b.lo, b.lc, b.hc);
  writeFill(b.rows, b.cols, b.lo, b.hi, b.lc, b.hc, [srcRow as string[]]);
}

function anyOverlayOpen(): boolean {
  return ["colMenu", "configModal", "mapModal", "ciModal", "letterPop"]
    .some(id => { const n = $(id); return n && !n.classList.contains("hidden"); }) ||
    !!document.querySelector("td.edit-input") ||
    !!document.querySelector(".msrPick");
}

function getSelFocus() { return sel().focus; }
function getLastCopy() { return lastCopy; }
function getSelAnchor() { return sel().anchor; }

export {
  restorePendingSel,
  ensureDefaultSelection,
  rowIdxOf,
  colIdxOf,
  hasSelection,
  clearSelection,
  selectionBounds,
  setSelPoint,
  moveSel,
  moveToRowFirstLast,
  movePage,
  applySelHighlight,
  positionFillHandle,
  scrollSelIntoView,
  selectedTd,
  rangeTsv,
  copySelectedRange,
  anyOverlayOpen,
  handlePaste,
  pasteIntoSelection,
  fillFromSelectionOrigin,
  getLastCopy,
  undoLast,
  clearUndo,
  getSelFocus,
  getSelAnchor,
  saveSel
};
export type { Bounds };
import { $, visibleCols } from "./core.ts";
import type { ViewerRow, ViewerCol } from "./core.ts";
import { currentRows, hasDataRows } from "./grid-data.ts";
import { setSelectionHooks } from "./grid.ts";
import { selStore, saveSel } from "./store.ts";

type Bounds = { rows: ViewerRow[]; cols: ViewerCol[]; lo: number; hi: number; lc: number; hc: number };

setSelectionHooks({
  highlight: applySelHighlight,
  clearUndo: () => {},
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
  const focus = sel().focus;
  if (!focus || !hasDataRows()) return;
  const rows = currentRows();
  const cols = visibleCols();
  const ri = rowIdxOf(focus.sysId, rows);
  const ci = colIdxOf(focus.key, cols);
  if (ri < 0 || ci < 0) return;
  const tbody = $("tbl").tBodies[0];
  const tr = tbody.rows[ri];
  if (!tr) return;
  const tdEl = tr.children[ci] as HTMLElement | undefined;
  if (!tdEl) return;
  tdEl.classList.add("sel");
  tdEl.style.boxShadow = "inset 0 0 0 2px #89b4fa";
  selStore.setState({ prev: [tdEl] });
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

function anyOverlayOpen(): boolean {
  return ["colMenu", "configModal", "mapModal", "ciModal", "letterPop"]
    .some(id => { const n = $(id); return n && !n.classList.contains("hidden"); }) ||
    !!document.querySelector(".msrPick");
}

function getSelFocus() { return sel().focus; }
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
  scrollSelIntoView,
  selectedTd,
  anyOverlayOpen,
  getSelFocus,
  getSelAnchor,
  saveSel
};
export type { Bounds };

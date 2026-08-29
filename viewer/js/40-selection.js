import { $, visibleCols } from "./00-core.js";
import { showToast } from "../../lib/toast.js";
import { cellValue, tsvCell } from "./15-clipboard.js";
import { currentRows, hasDataRows } from "./30-grid.js";
import { copyText } from "./85-shared.js";
import { selStore, saveSel } from "./00-store.js";


function sel() { return selStore.getState(); }

function restorePendingSel() {
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

function ensureDefaultSelection() {
  if (hasDataRows() && !sel().focus && !sel().pending) moveSel(0, 0, false);
}

function rowIdxOf(sysId, rows) {
  return rows.findIndex(r => String(r.sysId ?? "") === String(sysId ?? ""));
}
function colIdxOf(key, cols) {
  return cols.findIndex(c => c[0] === key);
}

function hasSelection() {
  return !!(sel().anchor || sel().focus);
}

async function clearSelection() {
  selStore.setState({ anchor: null, focus: null });
  await saveSel();
  applySelHighlight();
}

function selectionBounds() {
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

async function setSelPoint(sysId, key, extend) {
  const { anchor } = sel();
  const next = {
    anchor: (!extend || !anchor) ? { sysId, key } : anchor,
    focus: { sysId, key }
  };
  selStore.setState(next);
  await saveSel();
  applySelHighlight();
}

function moveSel(dr, dc, extend) {
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

function moveToRowFirstLast(extend, which) {
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

function movePage(dr, extend) {
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

function applySelHighlight() {
  for (const tdEl of sel().prev) {
    tdEl.classList.remove("sel", "selr");
    tdEl.style.boxShadow = "";
  }
  selStore.setState({ prev: [] });
  const b = selectionBounds();
  if (!b) return;
  const want = new Set(b.rows.slice(b.lo, b.hi + 1).map(r => String(r.sysId ?? "")));
  const topSysId = String(b.rows[b.lo].sysId ?? "");
  const bottomSysId = String(b.rows[b.hi].sysId ?? "");
  const focusSysId = String(sel().focus.sysId);
  const EDGE = "inset 0 0 0 1px #89b4fa";
  const tbody = $("tbl").tBodies[0];
  const prev = [];
  for (const tr of tbody.rows) {
    if (!want.has(tr.dataset.sysId)) continue;
    const isTop = tr.dataset.sysId === topSysId;
    const isBottom = tr.dataset.sysId === bottomSysId;
    [...tr.children].forEach((tdEl, ci) => {
      if (ci < b.lc || ci > b.hc) return;
      tdEl.classList.add("selr");
      const edges = [];
      if (isTop) edges.push("inset 0 2px 0 #89b4fa");
      if (isBottom) edges.push("inset 0 -2px 0 #89b4fa");
      if (ci === b.lc) edges.push("inset 2px 0 0 #89b4fa");
      if (ci === b.hc) edges.push("inset -2px 0 0 #89b4fa");
      const isFocus = tr.dataset.sysId === focusSysId && b.cols[ci][0] === sel().focus.key;
      tdEl.style.boxShadow = isFocus
        ? "inset 0 0 0 2px #89b4fa"
        : (edges.length ? [...edges, EDGE].join(", ") : "");
      prev.push(tdEl);
    });
  }
  selStore.setState({ prev });
}

function scrollSelIntoView() {
  const focus = sel().focus;
  if (!focus) return;
  const tr = $("tbl").tBodies[0].querySelector(`tr[data-sys-id="${CSS.escape(focus.sysId)}"]`);
  if (!tr) return;
  const cols = visibleCols();
  const ci = colIdxOf(focus.key, cols);
  const td = tr.children[ci];
  if (td) td.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function selectedTd() {
  const focus = sel().focus;
  if (!focus) return null;
  const tr = $("tbl").tBodies[0].querySelector(`tr[data-sys-id="${CSS.escape(focus.sysId)}"]`);
  if (!tr) return null;
  const ci = colIdxOf(focus.key, visibleCols());
  return ci >= 0 ? tr.children[ci] : null;
}

function rangeTsv() {
  const b = selectionBounds();
  if (!b) return null;
  const lines = b.rows.slice(b.lo, b.hi + 1).map(row =>
    b.cols.slice(b.lc, b.hc + 1).map(c => tsvCell(cellValue(row, c[0], c[2]))).join("\t")
  );
  return { text: lines.join("\n"), rowCount: b.hi - b.lo + 1, colCount: b.hc - b.lc + 1 };
}

function copySelectedRange() {
  const out = rangeTsv();
  if (!out) return;
  copyText(out.text)
    .then(() => showToast(`Copied ${out.rowCount} row${out.rowCount === 1 ? "" : "s"} to clipboard`))
    .catch(() => showToast("Copy failed", "error"));
}

function anyOverlayOpen() {
  return ["colMenu", "configModal", "mapModal", "ciModal", "letterPop"]
    .some(id => { const n = $(id); return n && !n.classList.contains("hidden"); }) ||
    !!document.querySelector("td.edit-input") ||
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
  rangeTsv,
  copySelectedRange,
  anyOverlayOpen,
  getSelFocus,
  getSelAnchor,
  saveSel
};

import { $, setStatus, visibleCols } from "./00-core.js";
import { cellValue, tsvCell } from "./15-clipboard.js";
import { currentRows, hasDataRows } from "./30-grid.js.back";
import { copyText } from "./85-shared.js";


let selAnchor = null;
let selFocus = null;
let selPrev = [];
let pendingSel = null;

function persistSel() {
  try {
    if (selAnchor && selFocus) {
      chrome.storage.local.set({ viewerSel: { a: selAnchor, f: selFocus } });
    } else {
      chrome.storage.local.remove("viewerSel");
    }
  } catch {}
}

chrome.storage.local.get(["viewerSel"], ({ viewerSel }) => {
  if (viewerSel && viewerSel.a && viewerSel.f &&
      typeof viewerSel.a.sysId === "string" && typeof viewerSel.a.key === "string") {
    pendingSel = viewerSel;
    restorePendingSel();
  }
});

function restorePendingSel() {
  if (!pendingSel || !hasDataRows()) return;
  const rows = currentRows();
  const cols = visibleCols();
  const ri = rowIdxOf(pendingSel.f.sysId, rows);
  const ci = colIdxOf(pendingSel.f.key, cols);
  if (ri < 0 || ci < 0) {
    pendingSel = null;
    return;
  }
  selAnchor = { ...pendingSel.a };
  selFocus = { ...pendingSel.f };
  pendingSel = null;
  applySelHighlight();
  scrollSelIntoView();
}

function ensureDefaultSelection() {
  if (hasDataRows() && !selFocus && !pendingSel) moveSel(0, 0, false);
}

function rowIdxOf(sysId, rows) {
  return rows.findIndex(r => String(r.sysId ?? "") === String(sysId ?? ""));
}
function colIdxOf(key, cols) {
  return cols.findIndex(c => c[0] === key);
}

function hasSelection() {
  return !!(selAnchor || selFocus);
}

function clearSelection() {
  selAnchor = null;
  selFocus = null;
  persistSel();
  applySelHighlight();
}

function selectionBounds() {
  if (!selAnchor || !selFocus || !hasDataRows()) return null;
  const rows = currentRows();
  const cols = visibleCols();
  const r1 = rowIdxOf(selAnchor.sysId, rows);
  const r2 = rowIdxOf(selFocus.sysId, rows);
  const c1 = colIdxOf(selAnchor.key, cols);
  const c2 = colIdxOf(selFocus.key, cols);
  if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) return null;
  return {
    rows, cols,
    lo: Math.min(r1, r2), hi: Math.max(r1, r2),
    lc: Math.min(c1, c2), hc: Math.max(c1, c2)
  };
}

function setSelPoint(sysId, key, extend) {
  if (!extend || !selAnchor) selAnchor = { sysId, key };
  selFocus = { sysId, key };
  persistSel();
  applySelHighlight();
}

function moveSel(dr, dc, extend) {
  const rows = currentRows();
  const cols = visibleCols();
  if (!rows.length || !cols.length) return;
  let ri = 0, ci = 0;
  if (selFocus) {
    ri = rowIdxOf(selFocus.sysId, rows);
    ci = colIdxOf(selFocus.key, cols);
    if (ri < 0 || ci < 0) { ri = 0; ci = 0; }
  }
  ri = Math.min(rows.length - 1, Math.max(0, ri + dr));
  ci = Math.min(cols.length - 1, Math.max(0, ci + dc));
  setSelPoint(String(rows[ri].sysId ?? ""), cols[ci][0], extend);
  scrollSelIntoView();
}

function applySelHighlight() {
  for (const tdEl of selPrev) {
    tdEl.classList.remove("sel", "selr");
    tdEl.style.boxShadow = "";
  }
  selPrev = [];
  const b = selectionBounds();
  if (!b) return;
  const want = new Set(b.rows.slice(b.lo, b.hi + 1).map(r => String(r.sysId ?? "")));
  const topSysId = String(b.rows[b.lo].sysId ?? "");
  const bottomSysId = String(b.rows[b.hi].sysId ?? "");
  const focusSysId = String(selFocus.sysId);
  const EDGE = "inset 0 0 0 1px #89b4fa";
  const tbody = $("tbl").tBodies[0];
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
      const isFocus = tr.dataset.sysId === focusSysId && b.cols[ci][0] === selFocus.key;
      tdEl.style.boxShadow = isFocus
        ? "inset 0 0 0 2px #89b4fa"
        : (edges.length ? [...edges, EDGE].join(", ") : "");
      selPrev.push(tdEl);
    });
  }
}

function scrollSelIntoView() {
  if (!selFocus) return;
  const tr = $("tbl").tBodies[0].querySelector(`tr[data-sys-id="${CSS.escape(selFocus.sysId)}"]`);
  if (!tr) return;
  const cols = visibleCols();
  const ci = colIdxOf(selFocus.key, cols);
  const td = tr.children[ci];
  if (td) td.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function selectedTd() {
  if (!selFocus) return null;
  const tr = $("tbl").tBodies[0].querySelector(`tr[data-sys-id="${CSS.escape(selFocus.sysId)}"]`);
  if (!tr) return null;
  const ci = colIdxOf(selFocus.key, visibleCols());
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
    .then(() => setStatus(`Copied ${out.rowCount} row(s) × ${out.colCount} column(s)`))
    .catch(err => setStatus(`Copy failed: ${err.message}`, true));
}

function anyOverlayOpen() {
  return ["colMenu", "exportMenu", "mapModal", "ciModal", "letterPop"]
    .some(id => { const n = $(id); return n && !n.classList.contains("hidden"); }) ||
    !!document.querySelector("td.edit-input") ||
    !!document.querySelector(".msrPick");
}

export {
  persistSel,
  restorePendingSel,
  ensureDefaultSelection,
  rowIdxOf,
  colIdxOf,
  hasSelection,
  clearSelection,
  selectionBounds,
  setSelPoint,
  moveSel,
  applySelHighlight,
  scrollSelIntoView,
  selectedTd,
  rangeTsv,
  copySelectedRange,
  anyOverlayOpen,
  selAnchor,
  selFocus,
  selPrev,
  pendingSel
};

import { $, visibleCols } from "./00-core.js";
import { findRowBySysId, render } from "./30-grid.js";
import { anyOverlayOpen, copySelectedRange, fillFromSelectionOrigin, getSelFocus, handlePaste, movePage, moveSel, moveToRowFirstLast, selectedTd, selectionBounds, setSelPoint, undoLast } from "./40-selection.js";
import { openTicketPopup } from "./50-ticketpop.js";
import { startEdit } from "./70-editors.js";


let dragSelecting = false;
let dragMoved = false;
let dragStartX = 0, dragStartY = 0;

let fillDragging = false;

const tbody = $("tbl").tBodies[0];

tbody.addEventListener("pointerdown", e => {
  const td = e.target.closest("td");
  if (!td || e.button !== 0) return;
  const tr = td.parentElement;
  const cols = visibleCols();
  const ci = [...tr.children].indexOf(td);
  if (ci < 0 || ci >= cols.length) return;
  dragSelecting = true;
  dragMoved = false;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  $("tbl").classList.add("selecting");
  setSelPoint(tr.dataset.sysId, cols[ci][0], false);
  try { tbody.setPointerCapture(e.pointerId); } catch {}
});

tbody.addEventListener("pointermove", e => {
  if (!dragSelecting) return;
  if (Math.abs(e.clientX - dragStartX) + Math.abs(e.clientY - dragStartY) > 4) dragMoved = true;
  const el = typeof document.elementFromPoint === "function" ? document.elementFromPoint(e.clientX, e.clientY) : null;
  const td = el && el.closest ? el.closest("td") : null;
  if (!td) return;
  const tr = td.parentElement;
  const cols = visibleCols();
  const ci = [...tr.children].indexOf(td);
  if (ci < 0 || ci >= cols.length) return;
  setSelPoint(tr.dataset.sysId, cols[ci][0], true);
});

function stopDrag() {
  if (dragSelecting) {
    dragSelecting = false;
    $("tbl").classList.remove("selecting");
  }
}
tbody.addEventListener("pointerup", stopDrag);
tbody.addEventListener("pointercancel", stopDrag);
document.addEventListener("pointerup", stopDrag);

$("tbl").tBodies[0].addEventListener("click", e => {
  if (dragMoved || anyOverlayOpen() || document.querySelector(".msrPick")) return;
  const td = e.target.closest("td");
  if (!td || !td.classList.contains("numLink")) return;
  const tr = td.parentElement;
  const row = findRowBySysId(tr.dataset.sysId);
  if (row) openTicketPopup(row);
});

$("tbl").tBodies[0].addEventListener("dblclick", e => {
  const td = e.target.closest("td");
  if (td) startEdit(td);
});

const handle = $("fillHandle");

function cellKeyAt(clientX, clientY) {
  const el = typeof document.elementFromPoint === "function" ? document.elementFromPoint(clientX, clientY) : null;
  const td = el && el.closest ? el.closest("td") : null;
  if (!td) return null;
  const tr = td.parentElement;
  const cols = visibleCols();
  const ci = [...tr.children].indexOf(td);
  if (ci < 0 || ci >= cols.length) return null;
  return { sysId: tr.dataset.sysId, key: cols[ci][0] };
}

if (handle) {
  handle.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    const focus = getSelFocus();
    if (!focus) return;
    e.preventDefault();
    e.stopPropagation();
    fillDragging = true;
    setSelPoint(focus.sysId, focus.key, false);
    try { handle.setPointerCapture(e.pointerId); } catch {}
  });

  handle.addEventListener("pointermove", e => {
    if (!fillDragging) return;
    const cell = cellKeyAt(e.clientX, e.clientY);
    if (!cell) return;
    setSelPoint(cell.sysId, cell.key, true);
  });

  function stopFill() {
    if (!fillDragging) return;
    fillDragging = false;
    const b = selectionBounds();
    if (b) fillFromSelectionOrigin(b);
  }
  handle.addEventListener("pointerup", stopFill);
  handle.addEventListener("pointercancel", stopFill);
}

document.addEventListener("keydown", e => {
  const t = e.target;
  if (t instanceof HTMLElement &&
      (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) {
    if (!anyOverlayOpen() && getSelFocus() && selectionBounds()) {
      e.preventDefault();
      copySelectedRange();
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) {
    if (!anyOverlayOpen() && getSelFocus() && selectionBounds()) {
      e.preventDefault();
      handlePaste();
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) {
    if (!anyOverlayOpen()) {
      e.preventDefault();
      undoLast();
    }
    return;
  }
  if (anyOverlayOpen()) return;
  switch (e.key) {
    case "ArrowDown": e.preventDefault(); moveSel(1, 0, e.shiftKey); break;
    case "ArrowUp": e.preventDefault(); moveSel(-1, 0, e.shiftKey); break;
    case "ArrowLeft": e.preventDefault(); moveSel(0, -1, e.shiftKey); break;
    case "ArrowRight": e.preventDefault(); moveSel(0, 1, e.shiftKey); break;
    case "Home": e.preventDefault(); moveToRowFirstLast(e.shiftKey, "first"); break;
    case "End": e.preventDefault(); moveToRowFirstLast(e.shiftKey, "last"); break;
    case "PageDown": e.preventDefault(); movePage(1, e.shiftKey); break;
    case "PageUp": e.preventDefault(); movePage(-1, e.shiftKey); break;
    case "Tab": if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); moveSel(0, e.shiftKey ? -1 : 1, false); } break;
    case "Enter":
    case "F2": {
      const td = selectedTd();
      if (td) {
        e.preventDefault();
        startEdit(td);
      }
      break;
    }
  }
});

$("search").addEventListener("input", render);

export {
  dragSelecting,
  dragMoved,
  cellKeyAt
};

import { $, visibleCols } from "./00-core.js";
import { findRowBySysId, render } from "./30-grid.js";
import { anyOverlayOpen, copySelectedRange, getSelFocus, moveSel, selectedTd, selectionBounds, setSelPoint } from "./40-selection.js";
import { openTicketPopup } from "./50-ticketpop.js";
import { startEdit } from "./70-editors.js";


let dragSelecting = false;
let dragMoved = false;

$("tbl").tBodies[0].addEventListener("mousedown", e => {
  const td = e.target.closest("td");
  if (!td || e.button !== 0) return;
  const tr = td.parentElement;
  const cols = visibleCols();
  const ci = [...tr.children].indexOf(td);
  if (ci < 0 || ci >= cols.length) return;
  dragSelecting = true;
  dragMoved = false;
  $("tbl").classList.add("selecting");
  setSelPoint(tr.dataset.sysId, cols[ci][0], false);
});

$("tbl").tBodies[0].addEventListener("mouseover", e => {
  if (!dragSelecting) return;
  const td = e.target.closest("td");
  if (!td) return;
  const tr = td.parentElement;
  const cols = visibleCols();
  const ci = [...tr.children].indexOf(td);
  if (ci < 0 || ci >= cols.length) return;
  dragMoved = true;
  setSelPoint(tr.dataset.sysId, cols[ci][0], true);
});

$("tbl").tBodies[0].addEventListener("click", e => {
  if (dragMoved || anyOverlayOpen() || document.querySelector(".msrPick")) return;
  const td = e.target.closest("td");
  if (!td || !td.classList.contains("numLink")) return;
  const tr = td.parentElement;
  const row = findRowBySysId(tr.dataset.sysId);
  if (row) openTicketPopup(row);
});

document.addEventListener("mouseup", () => {
  if (dragSelecting) {
    dragSelecting = false;
    $("tbl").classList.remove("selecting");
  }
});

$("tbl").tBodies[0].addEventListener("dblclick", e => {
  const td = e.target.closest("td");
  if (td) startEdit(td);
});

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
  if (anyOverlayOpen()) return;
  switch (e.key) {
    case "ArrowDown": e.preventDefault(); moveSel(1, 0, e.shiftKey); break;
    case "ArrowUp": e.preventDefault(); moveSel(-1, 0, e.shiftKey); break;
    case "ArrowLeft": e.preventDefault(); moveSel(0, -1, e.shiftKey); break;
    case "ArrowRight": e.preventDefault(); moveSel(0, 1, e.shiftKey); break;
    case "Tab": e.preventDefault(); moveSel(0, e.shiftKey ? -1 : 1, false); break;
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
  dragMoved
};

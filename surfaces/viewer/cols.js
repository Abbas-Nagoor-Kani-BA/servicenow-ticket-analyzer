import { removeValue, saveValue } from "../../lib/storage.ts";
import { STORAGE } from "../../lib/keys.ts";
import { showToast } from "../../lib/toast.ts";
import { setHiddenCols } from "./store.js";
import { buildHead, load, render, resetColWidths } from "./grid.js";
import { $, COLUMNS, hideStore, setStatus } from "./core.js";


function updateColsBtn() {
  $("colsBtn").textContent = hideStore().size ? `Columns (${hideStore().size} hidden)` : "Columns";
}

export function initCols() {
  $("clearBtn").addEventListener("click", async () => {
    await removeValue(STORAGE.lastData);
    load(null);
    showToast("Pull data cleared");
  });

  $("colsBtn").addEventListener("click", e => {
    e.stopPropagation();
    const menu = $("colMenu");
    if (menu.classList.contains("hidden")) {
      buildColMenu();
      $("colSearch").value = "";
      setTimeout(() => $("colSearch").focus(), 0);
    }
    menu.classList.toggle("hidden");
  });

  $("colSearch").addEventListener("input", e => {
    const q = e.target.value.trim().toLowerCase();
    for (const lab of $("colList").children) {
      lab.style.display = !q || lab.textContent.toLowerCase().includes(q) ? "" : "none";
    }
  });

  $("showAllCols").addEventListener("click", async () => {
    setHiddenCols(new Set());
    try {
      await saveValue(STORAGE.viewerHiddenCols, []);
    } catch {}
    $("colMenu").classList.add("hidden");
    buildHead();
    render();
    updateColsBtn();
    setStatus("All columns visible");
  });

  $("resetColWidthsBtn").addEventListener("click", () => {
    resetColWidths();
    setStatus("Column widths reset");
  });
}

function buildColMenu() {
  const list = $("colList");
  list.innerHTML = "";
  for (const [key, label] of COLUMNS) {
    const lab = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !hideStore().has(key);
    cb.addEventListener("change", () => toggleCol(key, cb.checked));
    const span = document.createElement("span");
    span.textContent = label;
    lab.append(cb, span);
    list.appendChild(lab);
  }
}

async function toggleCol(key, show) {
  const hc = hideStore();
  if (!show && COLUMNS.length - hc.size <= 1) {
    setStatus("At least one column must stay visible", true);
    buildColMenu();
    return;
  }
  if (show) hc.delete(key);
  else hc.add(key);
  setHiddenCols(new Set(hc));
  try {
    await saveValue(STORAGE.viewerHiddenCols, [...hc]);
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, true);
  }
  buildHead();
  render();
  updateColsBtn();
}

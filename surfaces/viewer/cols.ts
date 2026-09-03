import { removeValue, saveValue } from "../../lib/storage.ts";
import { STORAGE } from "../../lib/keys.ts";
import { showToast } from "../../lib/toast.ts";
import { iconize } from "../../lib/icons.ts";
import { setHiddenCols } from "./store.ts";
import { buildHead, load, render, resetColWidths } from "./grid.ts";
import { $, COLUMNS, hideStore, setColumnVisible, setStatus } from "./core.ts";

function updateColsBtn(): void {
  const btn = $("colsBtn");
  const n = hideStore().size;
  // Icon-only button: show the hidden count as a badge + in the tooltip, not text.
  btn.classList.toggle("has-badge", n > 0);
  btn.setAttribute("data-badge", n > 0 ? String(n) : "");
  btn.setAttribute("data-tip", n > 0
    ? `Choose which columns are shown (${n} hidden)`
    : "Choose which columns are shown");
}

export function initCols(): void {
  $("colsBtn").textContent = "Columns";
  iconize($("colsBtn"), "columns-3", { tip: "Choose which columns are shown" });
  $("clearBtn").textContent = "Clear";
  iconize($("clearBtn"), "trash-2", { tip: "Clear pulled data" });
  iconize($("showAllCols"), "check-circle-2");
  iconize($("resetColWidthsBtn"), "rotate-ccw");

  $("clearBtn").addEventListener("click", async () => {
    await removeValue(STORAGE.lastData);
    load(null);
    showToast("Pull data cleared");
  });

  $("colsBtn").addEventListener("click", (e: Event) => {
    e.stopPropagation();
    const menu = $("colMenu");
    if (menu.classList.contains("hidden")) {
      buildColMenu();
      $("colSearch").value = "";
      setTimeout(() => $("colSearch").focus(), 0);
    }
    menu.classList.toggle("hidden");
  });

  $("colSearch").addEventListener("input", (e: Event) => {
    const q = (e.target as HTMLInputElement).value.trim().toLowerCase();
    for (const lab of $("colList").children) {
      lab.style.display = !q || lab.textContent.toLowerCase().includes(q) ? "" : "none";
    }
  });

  $("showAllCols").addEventListener("click", async () => {
    setHiddenCols(new Set());
    try {
      await saveValue(STORAGE.viewerHiddenCols, []);
    } catch { /* ignored */ }
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

function buildColMenu(): void {
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

async function toggleCol(key: string, show: boolean): Promise<void> {
  if (!setColumnVisible(key, show)) {
    setStatus("At least one column must stay visible", true);
    buildColMenu();
    return;
  }
  buildHead();
  render();
  updateColsBtn();
}
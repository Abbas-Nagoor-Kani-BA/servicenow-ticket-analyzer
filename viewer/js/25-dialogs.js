import * as Markup from "../../lib/markup.js";
import { STORAGE } from "../../lib/keys.ts";
import { setTip } from "../../lib/tooltip.js";
import { $, setStatus } from "./00-core.js";
import { Modal, hasOpenModal } from "../../components/modal.ts";
import { CiDialog } from "../../components/ci-dialog.ts";
import { DEFAULT_EXPORT_MAP, EXPORT_FIELD_BY_ID, EXPORT_GROUPS, MAP_MAX_COL } from "./10-exporter.js";
import { getCiSplit, setCiSplit, setSavedMapPresent, syncSplitRadio, updateCiBtn, updateExportDots, closeConfigDialog } from "./05-config-state.js";
import { clearSelection, hasSelection } from "./40-selection.js";


let mapWorking = {};
const mapSelects = new Map();

async function openMapDialog() {
  let stored = null;
  try {
    ({ exportColMap: stored } = await chrome.storage.local.get(STORAGE.exportColMap));
  } catch {}
  setSavedMapPresent(!!(stored && Object.keys(stored).length));
  updateExportDots();
  mapWorking = {};
  const base = stored && Object.keys(stored).length ? stored : DEFAULT_EXPORT_MAP;
  for (const [fid, letter] of Object.entries(base)) {
    const col = Markup.letterToColNum(letter);
    if (EXPORT_FIELD_BY_ID.has(fid) && col >= 1 && col <= MAP_MAX_COL) {
      mapWorking[fid] = Markup.colLetter(col);
    }
  }
  buildMapList();
  $("mapSearch").value = "";
  filterMapRows("");
  mapModal.open();
  setTimeout(() => $("mapSearch").focus(), 0);
}

function filterMapRows(q) {
  const kids = [...$("mapList").children];
  const rows = kids.filter(el => el.classList.contains("mapRow"));
  const noneEl = kids.find(el => el.classList.contains("mapNone"));
  const ql = q.trim().toLowerCase();
  let visibleRows = 0;
  for (const el of rows) {
    const hit = !ql || el.dataset.label.toLowerCase().includes(ql);
    el.style.display = hit ? "" : "none";
    if (hit) visibleRows++;
  }
  if (noneEl) {
    if (!visibleRows && ql) {
      noneEl.textContent = `No fields match "${q.trim()}"`;
      noneEl.style.display = "";
    } else {
      noneEl.style.display = "none";
    }
  }
}

$("mapSearch").addEventListener("input", e => filterMapRows(e.target.value));

function buildMapList() {
  const list = $("mapList");
  list.innerHTML = "";
  mapSelects.clear();
  for (const g of EXPORT_GROUPS) {
    for (const f of g.items) {
      const row = document.createElement("div");
      row.className = "mapRow";
      row.dataset.fid = f[0];
      row.dataset.label = f[1];
      const label = document.createElement("span");
      label.textContent = f[1];
      setTip(label, f[1]);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mapPick";
      setTip(btn, "Click to search and pick a column (A–AN)");
      btn.addEventListener("click", e => {
        e.stopPropagation();
        toggleLetterPop(f[0], btn);
      });
      row.append(label, btn);
      list.appendChild(row);
      mapSelects.set(f[0], btn);
    }
  }
  const noneEl = document.createElement("div");
  noneEl.className = "mapNone";
  noneEl.style.display = "none";
  list.appendChild(noneEl);
  syncMapSelects();
}

function syncMapSelects() {
  for (const [fid, btn] of mapSelects) {
    const l = mapWorking[fid] || "";
    btn.textContent = l || "— not exported —";
    btn.classList.toggle("set", !!l);
  }
  filterMapRows($("mapSearch").value);
}

let popTargetFid = null;

function toggleLetterPop(fid, btn) {
  const pop = $("letterPop");
  if (!pop.classList.contains("hidden") && popTargetFid === fid) {
    hideLetterPop();
    return;
  }
  popTargetFid = fid;
  $("letterSearch").value = "";
  buildLetterOptions();
  letterPop.open();
  const r = btn.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const left = Math.max(8, Math.min(r.right - pw, window.innerWidth - pw - 8));
  let top = r.bottom + 4;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 4);
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
  $("letterSearch").focus();
}

function hideLetterPop() {
  letterPop.close();
  popTargetFid = null;
}

function buildLetterOptions() {
  const list = $("letterList");
  list.innerHTML = "";
  const q = $("letterSearch").value.trim().toLowerCase();
  const holders = {};
  for (const [f, l] of Object.entries(mapWorking)) {
    if (l) holders[l] = f;
  }
  const add = (val, text, cls) => {
    const d = document.createElement("div");
    d.className = "letterOpt" + (cls ? ` ${cls}` : "");
    if (text.holder !== undefined) {
      d.append(text.letter, " ", text.holderEl);
    } else {
      d.textContent = text.label;
    }
    d.addEventListener("click", () => assignLetter(val));
    list.appendChild(d);
  };
  if (!q || "— not exported —".toLowerCase().includes(q)) {
    add("", { label: "— not exported —" }, "none");
  }
  for (let c = 1; c <= MAP_MAX_COL; c++) {
    const L = Markup.colLetter(c);
    const holderId = holders[L];
    const holderLabel = holderId ? (EXPORT_FIELD_BY_ID.get(holderId)?.label ?? "") : "";
    if (q && !L.toLowerCase().startsWith(q)) continue;
    let payload;
    let cls = "";
    if (holderId) {
      const holderEl = document.createElement("span");
      holderEl.className = "holder";
      holderEl.textContent = `· ${holderLabel}`;
      payload = { letter: L, holder: holderLabel, holderEl };
      if (holderId !== popTargetFid) cls = "taken";
    } else {
      payload = { label: L };
    }
    add(L, payload, cls);
  }
}

function assignLetter(val) {
  const fid = popTargetFid;
  if (fid) {
    if (val) {
      for (const [f, l] of Object.entries(mapWorking)) {
        if (f !== fid && l === val) delete mapWorking[f];
      }
      mapWorking[fid] = val;
    } else {
      delete mapWorking[fid];
    }
    syncMapSelects();
  }
  hideLetterPop();
}

$("letterSearch").addEventListener("input", buildLetterOptions);
$("letterSearch").addEventListener("keydown", e => {
  if (e.key === "Enter") {
    e.preventDefault();
    e.stopPropagation();
    const first = $("letterList").firstElementChild;
    if (first) first.click();
  }
});

$("mapSave").addEventListener("click", async () => {
  const entries = Object.entries(mapWorking).filter(([, l]) => l);
  const seen = new Set();
  for (const [, l] of entries) {
    if (seen.has(l)) {
      setStatus(`Two fields point at column ${l} — fix before saving`, true);
      return;
    }
    seen.add(l);
  }
  if (!entries.length) {
    setStatus("Map at least one field before saving", true);
    return;
  }
  try {
    await chrome.storage.local.set({ [STORAGE.exportColMap]: Object.fromEntries(entries) });
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, true);
    return;
  }
  setSavedMapPresent(true);
  updateExportDots();
  mapModal.close();
  setStatus(`Export mapping saved — ${entries.length} field(s), columns ${lettersSpan(entries)}`);
});

function lettersSpan(entries) {
  const cols = entries.map(([, l]) => Markup.letterToColNum(l)).sort((a, b) => a - b);
  return cols.map(Markup.colLetter).join(", ");
}

$("mapCancel").addEventListener("click", () => mapModal.close());
$("mapClose").addEventListener("click", () => mapModal.close());
document.addEventListener("keydown", e => {
  // Modals registered with the Modal base handle Escape themselves, innermost
  // first. This only runs when none of them did.
  if (e.key !== "Escape") return;
  if (hasOpenModal()) return;
  if (hasSelection() && !document.querySelector("td.edit-input") &&
      !document.querySelector(".msrPick")) {
    clearSelection();
  }
});

$("mapReset").addEventListener("click", async () => {
  try {
    await chrome.storage.local.remove(STORAGE.exportColMap);
  } catch {}
  mapWorking = { ...DEFAULT_EXPORT_MAP };
  buildMapList();
  setSavedMapPresent(false);
  updateExportDots();
  setStatus("Mapping reset — exports use the template's default layout until saved again");
});

// Escape used to be a hand-written if-chain over each overlay. Each is now a
// Modal, so the stack closes them innermost-first and none can be skipped.
const mapModal = new Modal($("mapModal"), {}, {
  // A cell editor inside the grid must keep its own Escape.
  escapeGuard: () => !!document.querySelector("td.edit-input input")
});

const letterPop = new Modal($("letterPop"), {}, {
  backdropClose: false
});

const ciModal = new Modal($("ciModal"), {}, {
  onClosed: () => syncSplitRadio()
});

const configModal = new Modal($("configModal"), {}, {
  onClosed: () => closeConfigDialog()
});

const ciEditor = new CiDialog($("ciModal"), {}, {
  onSave: async (value) => {
    setCiSplit(value);
    try {
      await chrome.storage.local.set({ [STORAGE.ciSplit]: getCiSplit() });
    } catch (err) {
      throw err;
    }
    ciModal.close();
    updateCiBtn();
  },
  onDisable: async () => {
    setCiSplit({ enabled: false, groups: [] });
    try {
      await chrome.storage.local.remove(STORAGE.ciSplit);
    } catch {}
    ciModal.close();
    updateCiBtn();
  },
  onClosed: () => {},
  status: (message, isError) => setStatus(message, isError)
});

// Close and cancel are plain dismissals; Save and Disable close themselves
// only after their own persistence succeeds.
for (const id of ["ciClose", "ciCancel"]) {
  $(id).addEventListener("click", () => ciModal.close());
}

function openCiDialog() {
  ciEditor.show(getCiSplit());
  ciModal.open();
}

export {
  openMapDialog,
  filterMapRows,
  buildMapList,
  syncMapSelects,
  toggleLetterPop,
  hideLetterPop,
  buildLetterOptions,
  assignLetter,
  lettersSpan,
  openCiDialog,
  mapModal,
  letterPop,
  ciModal,
  configModal
};

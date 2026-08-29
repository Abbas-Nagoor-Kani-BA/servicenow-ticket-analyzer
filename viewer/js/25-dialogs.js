import * as Markup from "../../lib/markup.js";
import { STORAGE } from "../../lib/keys.js";
import { setTip } from "../../lib/tooltip.js";
import { $, el, setStatus } from "./00-core.js";
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
  $("mapModal").classList.remove("hidden");
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
  pop.classList.remove("hidden");
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
  $("letterPop").classList.add("hidden");
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
  $("mapModal").classList.add("hidden");
  setStatus(`Export mapping saved — ${entries.length} field(s), columns ${lettersSpan(entries)}`);
});

function lettersSpan(entries) {
  const cols = entries.map(([, l]) => Markup.letterToColNum(l)).sort((a, b) => a - b);
  return cols.map(Markup.colLetter).join(", ");
}

$("mapCancel").addEventListener("click", () => $("mapModal").classList.add("hidden"));
$("mapClose").addEventListener("click", () => $("mapModal").classList.add("hidden"));
$("mapModal").addEventListener("click", e => {
  if (e.target === $("mapModal")) $("mapModal").classList.add("hidden");
});
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!$("letterPop").classList.contains("hidden")) {
    e.preventDefault();
    hideLetterPop();
    return;
  }
  if (!$("ciModal").classList.contains("hidden")) {
    e.preventDefault();
    $("ciModal").classList.add("hidden");
    syncSplitRadio();
    return;
  }
  if (!$("mapModal").classList.contains("hidden") &&
      !document.querySelector("td.edit-input input")) {
    e.preventDefault();
    $("mapModal").classList.add("hidden");
    return;
  }
  if (!$("configModal").classList.contains("hidden")) {
    e.preventDefault();
    closeConfigDialog();
    return;
  }
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

let ciDraft = [];
let ciDragSrc = null;

function openCiDialog() {
  ciDraft = getCiSplit().groups.map(g => ({ name: g.name, items: [...g.items] }));
  $("ciEnabled").checked = getCiSplit().enabled;
  renderCiGroups();
  $("ciModal").classList.remove("hidden");
}

function nextGroupName() {
  const used = new Set(ciDraft.map(g => g.name.toLowerCase()));
  for (let i = 0; i < 26; i++) {
    const n = `Group ${String.fromCharCode(65 + i)}`;
    if (!used.has(n.toLowerCase())) return n;
  }
  return `Group ${ciDraft.length + 1}`;
}


function renderCiGroups() {
  const board = $("groupBoard");
  board.innerHTML = "";
  ciDraft.forEach((g, gi) => {
    const card = el("div", "ciGroupCard");
    const head = el("div", "ciGroupHead");
    const nameIn = el("input", "ciGroupName");
    nameIn.value = g.name;
    nameIn.placeholder = `Group ${gi + 1}`;
    nameIn.addEventListener("change", () => {
      const t = nameIn.value.trim();
      if (t) g.name = t;
      else nameIn.value = g.name;
    });
    const del = el("button", "ciDelGroup");
    del.textContent = "✕";
    setTip(del, "Delete this group");
    del.addEventListener("click", () => {
      ciDraft.splice(gi, 1);
      renderCiGroups();
    });
    head.append(nameIn, del);
    const list = el("div", "ciItems");
    list.dataset.gi = String(gi);
    list.addEventListener("dragover", e => {
      e.preventDefault();
      list.classList.add("dragOver");
    });
    list.addEventListener("dragleave", () => list.classList.remove("dragOver"));
    list.addEventListener("drop", e => {
      e.preventDefault();
      list.classList.remove("dragOver");
      dropCiItem(Number(list.dataset.gi));
    });
    g.items.forEach((it, ii) => {
      const chip = el("div", "ciChip");
      chip.draggable = true;
      setTip(chip, "Drag to another group");
      const lbl = el("span", "lbl");
      lbl.textContent = it;
      const rm = el("button", "rm");
      rm.textContent = "✕";
      setTip(rm, "Remove this configuration item");
      rm.addEventListener("click", () => {
        g.items.splice(ii, 1);
        renderCiGroups();
      });
      chip.addEventListener("dragstart", () => {
        ciDragSrc = { gi, ii };
      });
      chip.append(lbl, rm);
      list.appendChild(chip);
    });
    const addRow = el("div", "ciAddRow");
    const inp = document.createElement("input");
    inp.placeholder = "Add configuration item";
    const addBtn = document.createElement("button");
    addBtn.textContent = "+";
    setTip(addBtn, "Add to this group");
    addBtn.addEventListener("click", () => commitCiInput(inp, g));
    inp.addEventListener("keydown", ev => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commitCiInput(inp, g);
      }
    });
    inp.addEventListener("paste", ev => {
      const txt = ev.clipboardData ? ev.clipboardData.getData("text") : "";
      if (!txt || !/[\n,;]/.test(txt)) return;
      ev.preventDefault();
      const gi = ciDraft.indexOf(g);
      let added = 0;
      for (const p of txt.split(/[\n,;]+/)) {
        if (addCiUnique(g, p)) added++;
      }
      if (added) {
        renderCiGroups();
        focusGroupInput(gi);
      }
    });
    addRow.append(inp, addBtn);
    card.append(head, list, addRow);
    board.appendChild(card);
  });
}

function addCiUnique(g, raw) {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  if (g.items.some(x => x.toLowerCase() === t.toLowerCase())) return false;
  g.items.push(t);
  return true;
}

function focusGroupInput(gi) {
  $("groupBoard").querySelectorAll(".ciGroupCard")[gi]?.querySelector(".ciAddRow input")?.focus();
}

function commitCiInput(inp, g) {
  const gi = ciDraft.indexOf(g);
  let added = 0;
  for (const p of inp.value.split(/[\n,;]+/)) {
    if (addCiUnique(g, p)) added++;
  }
  inp.value = "";
  if (added) {
    renderCiGroups();
    focusGroupInput(gi);
  }
}

function dropCiItem(targetGi) {
  if (!ciDragSrc || targetGi === ciDragSrc.gi) return;
  const src = ciDraft[ciDragSrc.gi];
  const tgt = ciDraft[targetGi];
  const [item] = src.items.splice(ciDragSrc.ii, 1);
  if (item && !tgt.items.some(x => x.toLowerCase() === item.toLowerCase())) {
    tgt.items.push(item);
  } else if (item) {
    src.items.splice(ciDragSrc.ii, 0, item);
  }
  ciDragSrc = null;
  renderCiGroups();
}

$("addGroupBtn").addEventListener("click", () => {
  ciDraft.push({ name: nextGroupName(), items: [] });
  renderCiGroups();
});

$("ciSave").addEventListener("click", async () => {
  const enabled = $("ciEnabled").checked;
  const seen = new Set();
  const groups = ciDraft
    .map(g => ({ name: String(g.name ?? "").trim(), items: [...g.items] }))
    .filter(g => g.items.length || g.name);
  groups.forEach((g, i) => {
    if (!g.name) g.name = `Group ${i + 1}`;
    let n = g.name;
    let k = 2;
    while (seen.has(n.toLowerCase())) n = `${g.name} ${k++}`;
    seen.add(n.toLowerCase());
    g.name = n;
  });
  if (enabled && !groups.length) {
    setStatus("Add at least one group or turn the split off", true);
    return;
  }
  if (enabled && !groups.some(g => g.items.length)) {
    setStatus("Add at least one configuration item or turn the split off", true);
    return;
  }
  setCiSplit({ enabled, groups });
  try {
    await chrome.storage.local.set({ [STORAGE.ciSplit]: getCiSplit() });
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, true);
    return;
  }
  $("ciModal").classList.add("hidden");
  syncSplitRadio();
  updateCiBtn();
  setStatus(enabled
    ? `Split enabled — one file per group (${groups.length} groups)`
    : "Split disabled — exports stay a single file");
});

$("ciDisable").addEventListener("click", async () => {
  setCiSplit({ enabled: false, groups: [] });
  try {
    await chrome.storage.local.remove(STORAGE.ciSplit);
  } catch {}
  $("ciModal").classList.add("hidden");
  syncSplitRadio();
  updateCiBtn();
  setStatus("Split disabled — exports stay a single file");
});
$("ciCancel").addEventListener("click", () => {
  $("ciModal").classList.add("hidden");
  syncSplitRadio();
});
$("ciClose").addEventListener("click", () => {
  $("ciModal").classList.add("hidden");
  syncSplitRadio();
});
$("ciModal").addEventListener("click", e => {
  if (e.target === $("ciModal")) {
    $("ciModal").classList.add("hidden");
    syncSplitRadio();
  }
});

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
  nextGroupName,
  renderCiGroups,
  addCiUnique,
  focusGroupInput,
  commitCiInput,
  dropCiItem
};

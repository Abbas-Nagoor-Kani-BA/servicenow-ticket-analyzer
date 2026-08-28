import * as Markup from "../../lib/markup.js";
import * as TemplateXml from "../../lib/templatexml.js";
import { STORAGE } from "../../lib/keys.js";
import { pad2 } from "../../lib/format.js";
import { $, setStatus } from "./00-core.js";
import { showToast } from "../../lib/toast.js";
import { EXPORT_FIELD_BY_ID, MAP_MAX_COL, TPL_COLUMNS } from "./10-exporter.js";
import { buildMsrTsv } from "./15-clipboard.js";
import { hideLetterPop, openCiDialog, openMapDialog } from "./25-dialogs.js";
import { currentRows, getTotalRows, hasDataRows, fmtInstant } from "./30-grid.js";
import { buildSlaSummaryRows } from "../../analysis/slasummary.js";
import { copyText } from "./85-shared.js";


let tplInfo = null;

let ciSplit = { enabled: false, groups: [] };
function getCiSplit() { return ciSplit; }
function setCiSplit(v) {
  ciSplit = {
    enabled: !!(v && v.enabled),
    groups: Array.isArray(v && v.groups)
      ? v.groups
          .filter(g => g && typeof g === "object")
          .map(g => ({
            name: String(g.name ?? ""),
            items: Array.isArray(g.items) ? g.items.filter(x => typeof x === "string" && x.trim()) : []
          }))
      : []
  };
}
chrome.storage.local.get([STORAGE.ciSplit], ({ ciSplit: cs }) => {
  if (cs && typeof cs === "object") {
    if (Array.isArray(cs.groups)) {
      ciSplit = {
        enabled: !!cs.enabled,
        groups: cs.groups
          .filter(g => g && typeof g === "object")
          .map(g => ({
            name: String(g.name ?? ""),
            items: Array.isArray(g.items) ? g.items.filter(x => typeof x === "string" && x.trim()) : []
          }))
      };
    } else if (Array.isArray(cs.items)) {
      ciSplit = {
        enabled: !!cs.enabled,
        groups: cs.items
          .filter(x => typeof x === "string" && x.trim())
          .map(ci => ({ name: ci, items: [ci] }))
      };
    }
    syncSplitRadio();
  }
});

function updateCiBtn() {
  updateExportDots();
}

function syncSplitRadio() {
  const active = ciSplit.enabled && ciSplit.groups.length;
  $("radSingle").checked = !active;
  $("radSplit").checked = !!active;
  updateExportDots();
}

$("radSingle").addEventListener("change", async () => {
  if (!$("radSingle").checked || !ciSplit.enabled) return;
  ciSplit = { ...ciSplit, enabled: false };
  await chrome.storage.local.set({ [STORAGE.ciSplit]: ciSplit });
  updateExportDots();
  showToast("Split export disabled — one file per export");
});

$("radSplit").addEventListener("change", () => {
  if (!$("radSplit").checked) return;
  if (!ciSplit.groups.length) {
    syncSplitRadio();
    openCiDialog();
    return;
  }
  if (ciSplit.enabled) return;
  ciSplit = { ...ciSplit, enabled: true };
  chrome.storage.local.set({ [STORAGE.ciSplit]: ciSplit }).then(() => {
    updateExportDots();
    showToast("Split export enabled — one file per CI group");
  });
});

function sanitizeFilePart(s) {
  return String(s).replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "group";
}

function buildCiGroups(rows) {
  const norm = s => String(s ?? "").trim().toLowerCase();
  const bounds = [];
  for (let gi = 0; gi < ciSplit.groups.length; gi++) {
    const g = ciSplit.groups[gi];
    for (const it of g.items) {
      const key = norm(it);
      if (key) bounds.push({ key, name: g.name, gi });
    }
  }
  const byGroup = new Map();
  const others = [];
  for (const r of rows) {
    const k = norm(r.configItem);
    let best = null;
    if (k) {
      for (const b of bounds) {
        if (k.startsWith(b.key) &&
          (!best || b.key.length > best.key.length || (b.key.length === best.key.length && b.gi < best.gi))) {
          best = b;
        }
      }
    }
    if (!best) {
      others.push(r);
    } else {
      if (!byGroup.has(best.name)) byGroup.set(best.name, []);
      byGroup.get(best.name).push(r);
    }
  }
  const out = ciSplit.groups
    .filter(g => byGroup.has(g.name))
    .map(g => ({ name: g.name, rows: byGroup.get(g.name) }));
  if (others.length) out.push({ name: "Others", rows: others });
  return out;
}

function b64FromBuffer(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function bufferFromB64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function loadTplInfo() {
  const { snXlsxTemplate: t } = await chrome.storage.local.get(STORAGE.snXlsxTemplate);
  tplInfo = t && t.dataB64 ? t : null;
  updateTplState();
}

function updateTplState() {
  const lbl = $("menuTplLabel");
  const clr = $("menuTplClear");
  if (tplInfo) {
    lbl.textContent = `Template: ${tplInfo.name}`;
    clr.classList.remove("hidden");
  } else {
    lbl.textContent = "No template — pick on export";
    clr.classList.add("hidden");
  }
}

$("menuTplBtn").addEventListener("click", async () => {
  $("exportMenu").classList.add("hidden");
  const f = await pickTemplateFile();
  if (!f) return;
  tplInfo = { name: f.name, dataB64: b64FromBuffer(await f.arrayBuffer()), savedAt: Date.now() };
  await chrome.storage.local.set({ [STORAGE.snXlsxTemplate]: tplInfo });
  updateTplState();
  showToast("Template set");
});

$("menuTplClear").addEventListener("click", async () => {
  $("exportMenu").classList.add("hidden");
  await chrome.storage.local.remove(STORAGE.snXlsxTemplate);
  tplInfo = null;
  updateTplState();
  showToast("Template cleared");
});

let savedMapPresent = false;
function getSavedMapPresent() { return savedMapPresent; }
function setSavedMapPresent(v) { savedMapPresent = v; }

function updateExportDots() {
  $("mapDot").classList.toggle("on", savedMapPresent);
  $("ciDot").classList.toggle("on", ciSplit.enabled);
}

chrome.storage.local.get([STORAGE.exportColMap], ({ exportColMap }) => {
  savedMapPresent = !!(exportColMap && Object.keys(exportColMap).length);
  updateExportDots();
});

$("menuMapBtn").addEventListener("click", e => {
  e.stopPropagation();
  $("exportMenu").classList.add("hidden");
  openMapDialog();
});

$("menuCiBtn").addEventListener("click", e => {
  e.stopPropagation();
  $("exportMenu").classList.add("hidden");
  openCiDialog();
});

$("exportMenuBtn").addEventListener("click", e => {
  e.stopPropagation();
  $("exportMenu").classList.toggle("hidden");
});

function pickTemplateFile() {
  return new Promise(resolve => {
    const inp = $("tplFile");
    inp.onchange = () => {
      const f = inp.files[0] || null;
      inp.value = "";
      resolve(f);
    };
    inp.click();
  });
}




function tplColumnsFromMap(map) {
  if (!map || typeof map !== "object") return TPL_COLUMNS;
  const byCol = new Map();
  for (const [fid, letter] of Object.entries(map)) {
    const f = EXPORT_FIELD_BY_ID.get(fid);
    const col = Markup.letterToColNum(letter);
    if (!f || col < 1 || col > MAP_MAX_COL) continue;
    byCol.set(col, f.get);
  }
  if (!byCol.size) return TPL_COLUMNS;
  const last = Math.max(MAP_MAX_COL, ...byCol.keys());
  const out = [];
  for (let c = 1; c <= last; c++) {
    out.push({ col: c, get: byCol.get(c) || (() => "") });
  }
  return out;
}











function filledFilename(templateName, groupLabel) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  const base = templateName.replace(/\.xlsx$/i, "");
  const mid = groupLabel ? `_${sanitizeFilePart(groupLabel)}` : "";
  return `${base}${mid}_filled_${stamp}.xlsx`;
}

$("exportBtn").addEventListener("click", async () => {
  if (!hasDataRows()) {
    setStatus("Nothing to export", true);
    return;
  }
  // Export exactly what the data view shows: same rows, same order
  // (current search filter + current sort), including all edits.
  const rows = currentRows();
  if (!rows.length) {
    setStatus("Nothing to export — search filter matches no rows", true);
    return;
  }
  try {
    if (!tplInfo) {
      const f = await pickTemplateFile();
      if (!f) {
        setStatus("Export cancelled — no template selected", true);
        return;
      }
      tplInfo = { name: f.name, dataB64: b64FromBuffer(await f.arrayBuffer()), savedAt: Date.now() };
      await chrome.storage.local.set({ [STORAGE.snXlsxTemplate]: tplInfo });
      updateTplState();
    }
    let savedMap = null;
    try {
      ({ exportColMap: savedMap } = await chrome.storage.local.get(STORAGE.exportColMap));
    } catch {}
    const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const downloadOut = (out, filename) => {
      const blob = new Blob([out], { type: mime });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename, saveAs: false }, () => {
        setTimeout(() => URL.revokeObjectURL(url), 120000);
      });
    };
    const tplCols = tplColumnsFromMap(savedMap);
    setStatus("Filling template…");
    if (ciSplit.enabled && ciSplit.groups.length) {
      const groups = buildCiGroups(rows);
      let total = 0;
      for (const g of groups) {
        const out = TemplateXml.fillTemplateBuffer(bufferFromB64(tplInfo.dataB64), g.rows, tplCols, undefined,
          buildSlaSummaryRows(g.rows, fmtInstant));
        downloadOut(out, filledFilename(tplInfo.name, g.name));
        total += g.rows.length;
      }
      showToast(`Export complete \u2014 ${groups.length} file(s), ${total} row(s)`);
      return;
    }
    const out = TemplateXml.fillTemplateBuffer(bufferFromB64(tplInfo.dataB64), rows, tplCols, undefined,
      buildSlaSummaryRows(rows, fmtInstant));
    downloadOut(out, filledFilename(tplInfo.name));
    const filtered = rows.length !== getTotalRows() ? " (filtered)" : "";
    showToast(`Export complete \u2014 ${rows.length} row${rows.length === 1 ? "" : "s"}${filtered}`);
  } catch (err) {
    showToast(`Export failed: ${err.message}`, "error");
  }
});

$("copyMsrBtn").addEventListener("click", () => {
  if (!hasDataRows()) {
    setStatus("Nothing to copy", true);
    return;
  }
  const rows = currentRows();
  if (!rows.length) {
    setStatus("Nothing to copy — search filter matches no rows", true);
    return;
  }
  copyText(buildMsrTsv(rows))
    .then(() => showToast(`Copied ${rows.length} row${rows.length === 1 ? "" : "s"} to clipboard`))
    .catch(() => showToast("Copy failed", "error"));
});

document.addEventListener("click", e => {
  const menu = $("colMenu");
  if (!menu.classList.contains("hidden") && !menu.contains(e.target)) {
    menu.classList.add("hidden");
  }
  const em = $("exportMenu");
  if (!em.classList.contains("hidden") && !em.contains(e.target) &&
      !$("exportMenuBtn").contains(e.target)) {
    em.classList.add("hidden");
  }
  const pop = $("letterPop");
  if (!pop.classList.contains("hidden") && !pop.contains(e.target)) {
    hideLetterPop();
  }
});

export {
  getCiSplit,
  setCiSplit,
  updateCiBtn,
  syncSplitRadio,
  sanitizeFilePart,
  buildCiGroups,
  b64FromBuffer,
  bufferFromB64,
  loadTplInfo,
  updateTplState,
  getSavedMapPresent,
  setSavedMapPresent,
  updateExportDots,
  pickTemplateFile,
  tplColumnsFromMap,
  filledFilename,
  tplInfo,
  ciSplit,
  savedMapPresent
};

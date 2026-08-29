import * as Markup from "../../lib/markup.js";
import * as TemplateXml from "../../lib/templatexml.js";
import { STORAGE } from "../../lib/keys.js";
import { pad2 } from "../../lib/format.js";
import { $, setStatus, el } from "./00-core.js";
import {
  getCiSplit, setCiSplit, getSavedMapPresent, setSavedMapPresent,
  syncSplitRadio, closeConfigDialog, updateCiBtn, updateExportDots, setOnConfigChange
} from "./05-config-state.js";
import { showToast } from "../../lib/toast.js";
import { EXPORT_FIELD_BY_ID, MAP_MAX_COL, TPL_COLUMNS } from "./10-exporter.js";
import { buildMsrTsv } from "./15-clipboard.js";
import { hideLetterPop, openCiDialog, openMapDialog } from "./25-dialogs.js";
import { currentRows, getTotalRows, hasDataRows, fmtInstant } from "./30-grid.js";
import { buildSlaSummaryRows } from "../../analysis/slasummary.js";
import { copyText } from "./85-shared.js";


let tplInfo = null;

setOnConfigChange(updateConfigSummary);

$("radSingle").addEventListener("change", async () => {
  if (!$("radSingle").checked || !getCiSplit().enabled) return;
  setCiSplit({ ...getCiSplit(), enabled: false });
  await chrome.storage.local.set({ [STORAGE.ciSplit]: getCiSplit() });
  updateExportDots();
  showToast("Split export disabled — one file per export");
});

$("radSplit").addEventListener("change", () => {
  if (!$("radSplit").checked) return;
  if (!getCiSplit().groups.length) {
    syncSplitRadio();
    openCiDialog();
    return;
  }
  if (getCiSplit().enabled) return;
  setCiSplit({ ...getCiSplit(), enabled: true });
  chrome.storage.local.set({ [STORAGE.ciSplit]: getCiSplit() }).then(() => {
    updateExportDots();
    showToast("Split export enabled — one file per CI group");
  });
});

function sanitizeFilePart(s) {
  return String(s).replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "group";
}

function buildCiGroups(rows) {
  const norm = s => String(s ?? "").trim().toLowerCase();
  const groupsCfg = getCiSplit().groups;
  const bounds = [];
  for (let gi = 0; gi < groupsCfg.length; gi++) {
    const g = groupsCfg[gi];
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
        if ((k.startsWith(b.key) || k.includes(b.key)) &&
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
  const out = groupsCfg
    .filter(g => byGroup.has(g.name))
    .map(g => ({ name: g.name, rows: byGroup.get(g.name) }));
  if (others.length) out.push({ name: "Others", rows: others });
  return out;
}

function ciSplitDiagnostics(groups, rows) {
  const names = new Set(groups.map(g => g.name));
  const others = groups.find(g => g.name === "Others");
  const emptyGroups = getCiSplit().groups
    .filter(g => g.items.length && !names.has(g.name))
    .map(g => g.name);
  return {
    total: rows.length,
    others: others ? others.rows.length : 0,
    emptyGroups
  };
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
  const lbl = $("cfgTplLabel");
  const clr = $("cfgTplClear");
  if (tplInfo) {
    lbl.textContent = `Template: ${tplInfo.name}`;
    clr.classList.remove("hidden");
  } else {
    lbl.textContent = "No template";
    clr.classList.add("hidden");
  }
}

$("cfgTplBtn").addEventListener("click", async () => {
  const f = await pickTemplateFile();
  if (!f) return;
  tplInfo = { name: f.name, dataB64: b64FromBuffer(await f.arrayBuffer()), savedAt: Date.now() };
  await chrome.storage.local.set({ [STORAGE.snXlsxTemplate]: tplInfo });
  updateTplState();
  showToast("Template set");
});

$("cfgTplClear").addEventListener("click", async () => {
  await chrome.storage.local.remove(STORAGE.snXlsxTemplate);
  tplInfo = null;
  updateTplState();
  showToast("Template cleared");
});

$("cfgMapBtn").addEventListener("click", () => openMapDialog());
$("cfgCiBtn").addEventListener("click", () => openCiDialog());

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

function updateConfigSummary() {
  const split = getCiSplit();
  $("cfgSplitLabel").textContent =
    split.enabled && split.groups.length
      ? `Separate files \u2014 ${split.groups.length} group${split.groups.length === 1 ? "" : "s"}`
      : "Single file";
  $("cfgMapLabel").textContent = getSavedMapPresent() ? "Custom map" : "Defaults";
  updateTplState();
  updateSplitPreview();
}

function updateSplitPreview() {
  const el_ = $("cfgSplitPreview");
  const rows = currentRows();
  const split = getCiSplit();
  if (!split.enabled || !split.groups.length || !rows.length) {
    el_.classList.add("hidden");
    el_.innerHTML = "";
    return;
  }
  const groups = buildCiGroups(rows);
  const total = rows.length;
  const accounted = groups.reduce((n, g) => n + g.rows.length, 0);
  const items = groups.map(g => ({
    name: g.name,
    count: g.rows.length,
    zero: g.name !== "Others" && g.rows.length === 0
  }));
  if (items.some(x => x.zero)) {
    items.push({ name: "(no matching rows)", count: total - accounted, zero: true });
  }
  el_.innerHTML = "";
  const hint = el("div", "pvRow hint");
  hint.textContent = `Will export ${total} row${total === 1 ? "" : "s"} as ${items.length} file${items.length === 1 ? "" : "s"}:`;
  el_.appendChild(hint);
  for (const it of items) {
    const row = el("div", "pvRow");
    const name = el("span", "pvName" + (it.zero ? " pvZero" : ""));
    name.textContent = it.name;
    const cnt = el("span", "pvCount" + (it.zero ? " pvZero" : ""));
    cnt.textContent = String(it.count);
    row.append(name, cnt);
    el_.appendChild(row);
  }
  el_.classList.remove("hidden");
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

function openConfigDialog() {
  updateConfigSummary();
  $("configModal").classList.remove("hidden");
}

$("configClose").addEventListener("click", closeConfigDialog);
$("configCancel").addEventListener("click", closeConfigDialog);
$("configModal").addEventListener("click", e => {
  if (e.target === $("configModal")) closeConfigDialog();
});

$("configExport").addEventListener("click", runExport);

$("exportBtn").addEventListener("click", () => {
  if (!hasDataRows()) {
    setStatus("Nothing to export", true);
    return;
  }
  if (!currentRows().length) {
    setStatus("Nothing to export — search filter matches no rows", true);
    return;
  }
  openConfigDialog();
});

async function runExport() {
  // Export exactly what the data view shows: same rows, same order
  // (current search filter + current sort), including all edits.
  const rows = currentRows();
  if (!rows.length) {
    setStatus("Nothing to export — search filter matches no rows", true);
    closeConfigDialog();
    return;
  }
  try {
    if (!tplInfo) {
      closeConfigDialog();
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
    const downloadOne = (out, filename) => new Promise(resolve => {
      const blob = new Blob([out], { type: mime });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename, saveAs: false }, () => {
        const revoke = /** @type {{ unref?: () => void }} */ (
          /** @type {unknown} */ (setTimeout(() => URL.revokeObjectURL(url), 120000))
        );
        if (typeof revoke.unref === "function") revoke.unref();
        resolve();
      });
    });
    const tplCols = tplColumnsFromMap(savedMap);
    setStatus("Filling template…");
    const split = getCiSplit();
    if (split.enabled && split.groups.length) {
      const groups = buildCiGroups(rows);
      let total = 0;
      for (const g of groups) {
        const out = TemplateXml.fillTemplateBuffer(bufferFromB64(tplInfo.dataB64), g.rows, tplCols, undefined,
          buildSlaSummaryRows(g.rows, fmtInstant));
        await downloadOne(out, filledFilename(tplInfo.name, g.name));
        total += g.rows.length;
      }
      const per = groups.map(g => `${g.name} (${g.rows.length})`).join(", ");
      const diag = ciSplitDiagnostics(groups, rows);
      const warn = [];
      if (diag.emptyGroups.length) {
        warn.push(`Group${diag.emptyGroups.length > 1 ? "s" : ""} with no matching rows: ${diag.emptyGroups.join(", ")}`);
      }
      if (diag.others) {
        warn.push(`${diag.others} row${diag.others === 1 ? "" : "s"} unmatched (Others)`);
      }
      showToast(`Export complete \u2014 ${groups.length} file(s), ${total} row(s) \u2014 ${per}`
        + (warn.length ? ` \u2014 ${warn.join("; ")}` : ""));
      closeConfigDialog();
      return;
    }
    const out = TemplateXml.fillTemplateBuffer(bufferFromB64(tplInfo.dataB64), rows, tplCols, undefined,
      buildSlaSummaryRows(rows, fmtInstant));
    await downloadOne(out, filledFilename(tplInfo.name));
    const filtered = rows.length !== getTotalRows() ? " (filtered)" : "";
    showToast(`Export complete \u2014 ${rows.length} row${rows.length === 1 ? "" : "s"}${filtered}`);
    closeConfigDialog();
  } catch (err) {
    showToast(`Export failed: ${err.message}`, "error");
    closeConfigDialog();
  }
}

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
  ciSplitDiagnostics,
  b64FromBuffer,
  bufferFromB64,
  loadTplInfo,
  updateTplState,
  updateConfigSummary,
  openConfigDialog,
  closeConfigDialog,
  runExport,
  getSavedMapPresent,
  setSavedMapPresent,
  updateExportDots,
  pickTemplateFile,
  tplColumnsFromMap,
  filledFilename,
  tplInfo
};

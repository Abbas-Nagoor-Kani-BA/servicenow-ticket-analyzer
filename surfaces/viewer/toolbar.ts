import * as TemplateXml from "../../core/templatexml.ts";
import type { TemplateCol } from "../../core/templatexml.ts";
import { STORAGE } from "../../lib/keys.ts";
import {
  b64FromBuffer, bufferFromB64, sanitizeFilePart
} from "../../services/export-service.ts";
import type { CiGroupRows, TplCol } from "../../services/export-service.ts";
import { $, setStatus, el } from "./core.ts";
import type { ViewerRow } from "./core.ts";
import { buildSlaSummaryRowsFor } from "./core.ts";
import {
  getCiSplit, setCiSplit, getSavedMapPresent, setSavedMapPresent,
  syncSplitRadio, closeConfigDialog, updateCiBtn, updateExportDots, setOnConfigChange
} from "./config-state.ts";
import { showToast } from "../../lib/toast.ts";
import { exportSvc } from "./exporter.ts";
import { buildMsrTsv } from "./clipboard.ts";
import { configModal, hideLetterPop, openCiDialog, openMapDialog } from "./dialogs.ts";
import { currentRows, getTotalRows, hasDataRows, fmtInstant } from "./grid.ts";
import { copyText } from "./shared.ts";

type TplInfo = { name: string; dataB64: string; savedAt: number };

let tplInfo: TplInfo | null = null;

export function initToolbar(): void {
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

  $("configClose").addEventListener("click", closeConfigDialog);
  $("configCancel").addEventListener("click", closeConfigDialog);

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

  // Outside-click dismissal for the popovers that are not Modals.
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
}

function buildCiGroups(rows: ViewerRow[]): CiGroupRows[] {
  return exportSvc.buildCiGroups(rows, getCiSplit().groups);
}

function ciSplitDiagnostics(groups: CiGroupRows[], rows: ViewerRow[]): { total: number; others: number; emptyGroups: string[] } {
  return exportSvc.ciSplitDiagnostics(groups, rows, getCiSplit().groups);
}

async function loadTplInfo(): Promise<void> {
  const { snXlsxTemplate: t } = await chrome.storage.local.get(STORAGE.snXlsxTemplate);
  tplInfo = t && t.dataB64 ? t : null;
  updateTplState();
}

function updateTplState(): void {
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

function pickTemplateFile(): Promise<File | null> {
  return new Promise(resolve => {
    const inp = $("tplFile") as HTMLInputElement;
    inp.onchange = () => {
      const f = inp.files && inp.files[0] ? inp.files[0] : null;
      inp.value = "";
      resolve(f);
    };
    inp.click();
  });
}

function updateConfigSummary(): void {
  const split = getCiSplit();
  $("cfgSplitLabel").textContent =
    split.enabled && split.groups.length
      ? `Separate files \u2014 ${split.groups.length} group${split.groups.length === 1 ? "" : "s"}`
      : "Single file";
  $("cfgMapLabel").textContent = getSavedMapPresent() ? "Custom map" : "Defaults";
  updateTplState();
  updateSplitPreview();
}

function updateSplitPreview(): void {
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

function tplColumnsFromMap(map: unknown): TplCol[] {
  return exportSvc.tplColumnsFromMap(map);
}

function filledFilename(templateName: string, groupLabel?: string): string {
  return exportSvc.filledFilename(templateName, groupLabel);
}

function openConfigDialog(): void {
  updateConfigSummary();
  if (configModal) configModal.open();
}

async function runExport(): Promise<void> {
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
    let savedMap: Record<string, string> | null = null;
    try {
      ({ exportColMap: savedMap } = await chrome.storage.local.get(STORAGE.exportColMap));
    } catch { /* ignored */ }
    const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const downloadOne = (out: Uint8Array, filename: string) => new Promise<void>(resolve => {
      const blob = new Blob([out as unknown as BlobPart], { type: mime });
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename, saveAs: false }, () => {
        const revoke = setTimeout(() => URL.revokeObjectURL(url), 120000) as unknown as { unref?: () => void };
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
        const out = TemplateXml.fillTemplateBuffer(bufferFromB64(tplInfo.dataB64), g.rows, tplCols as unknown as TemplateCol[], undefined,
          buildSlaSummaryRowsFor(g.rows, fmtInstant));
        await downloadOne(out, filledFilename(tplInfo.name, g.name));
        total += g.rows.length;
      }
      const per = groups.map(g => `${g.name} (${g.rows.length})`).join(", ");
      const diag = ciSplitDiagnostics(groups, rows);
      const warn: string[] = [];
      if (diag.emptyGroups.length) {
        warn.push(`Group${diag.emptyGroups.length > 1 ? "" : "s"} with no matching rows: ${diag.emptyGroups.join(", ")}`);
      }
      if (diag.others) {
        warn.push(`${diag.others} row${diag.others === 1 ? "" : "s"} unmatched (Others)`);
      }
      showToast(`Export complete \u2014 ${groups.length} file(s), ${total} row(s) \u2014 ${per}`
        + (warn.length ? ` \u2014 ${warn.join("; ")}` : ""));
      closeConfigDialog();
      return;
    }
    const out = TemplateXml.fillTemplateBuffer(bufferFromB64(tplInfo.dataB64), rows, tplCols as unknown as TemplateCol[], undefined,
      buildSlaSummaryRowsFor(rows, fmtInstant));
    await downloadOne(out, filledFilename(tplInfo.name));
    const filtered = rows.length !== getTotalRows() ? " (filtered)" : "";
    showToast(`Export complete \u2014 ${rows.length} row${rows.length === 1 ? "" : "s"}${filtered}`);
    closeConfigDialog();
  } catch (err) {
    showToast(`Export failed: ${(err as Error).message}`, "error");
    closeConfigDialog();
  }
}

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
  filledFilename
};
import { getDefaultDatabase } from "../data/idb.ts";
import { ML_MODEL_CATALOG } from "../data/ml-model-repository.ts";
import { STORAGE } from "../lib/keys.ts";
import { showToast } from "../lib/toast.ts";
import { initTooltips } from "../lib/tooltip.ts";
import { createSettings, fillMsrLists, collectMsrLists } from "../surfaces/settings/index.ts";
import { normaliseSettings } from "../services/settings-service.ts";

import type { SettingsDraft } from "../services/settings-service.ts";
import type { MlModelOption } from "../data/ml-model-repository.ts";

const $ = (id: string): any => document.getElementById(id);

const page = createSettings();

// Populate the model dropdown from the catalog (kept in sync with the worker's
// supported set rather than hardcoded in HTML).
(function populateModelSelect(): void {
  const sel = $("mlModel");
  for (const opt of ML_MODEL_CATALOG) {
    const el = document.createElement("option");
    el.value = opt.id;
    el.textContent = opt.label;
    el.title = opt.description;
    sel.appendChild(el);
  }
  sel.value = ML_MODEL_CATALOG[0].id;
})();

function collect(): SettingsDraft {
  const draft = {
    version: 2,
    instanceUrl: $("instanceUrl").value.trim().replace(/\/+$/, ""),
    defaults: {
      ticketType: $("ticketType").value,
      queues: page.chips.queues.getValues(),
      teamMembers: page.chips.teamMembers.getValues()
    },
    params: {
      tablePageSize: $("tablePageSize").value,
      debugResponses: $("debugResponses").checked,
      cacheTtlMinutes: $("cacheTtlMinutes").value,
      maxTicketsPerPull: $("maxTicketsPerPull").value
    },
    ml: {
      mode: $("mlMode").value === "ml" ? "ml" : $("mlMode").value === "heuristic" ? "heuristic" : "hybrid",
      modelId: $("mlModel").value || ML_MODEL_CATALOG[0].id,
      cacheEnabled: $("mlCacheEnabled").checked
    }
  };
  return normaliseSettings(draft);
}
function fill(s: unknown): void {
  const merged = normaliseSettings(s);
  $("instanceUrl").value = merged.instanceUrl;
  $("ticketType").value = merged.defaults.ticketType;
  page.chips.queues.setValues(merged.defaults.queues);
  page.chips.teamMembers.setValues(merged.defaults.teamMembers);
  $("tablePageSize").value = merged.params.tablePageSize;
  $("debugResponses").checked = merged.params.debugResponses;
  $("cacheTtlMinutes").value = merged.params.cacheTtlMinutes;
  $("maxTicketsPerPull").value = merged.params.maxTicketsPerPull;
  $("mlMode").value = merged.ml.mode;
  $("mlCacheEnabled").checked = merged.ml.cacheEnabled;
  if (ML_MODEL_CATALOG.some((m) => m.id === merged.ml.modelId)) $("mlModel").value = merged.ml.modelId;
}
async function save(): Promise<void> {
  const settings = collect();
  await page.settings.save(settings);
  await page.msrLists.save(collectMsrLists(page));
  const q = settings.defaults.queues.length;
  const m = settings.defaults.teamMembers.length;
  showToast(`Settings saved \u2014 ${q} queue${q === 1 ? "" : "s"}, ${m} member${m === 1 ? "" : "s"}`);
}
$("saveBtn").addEventListener("click", () => save().catch((e) => showToast((e as Error).message, "error")));
initTooltips();
$("resetBtn").addEventListener("click", async () => {
  fill(null);
  await page.settings.reset();
  showToast("Settings reset to defaults");
});
$("msrResetBtn").addEventListener("click", async () => {
  fillMsrLists(page, page.settings.defaultMsrLists());
  await page.msrLists.clear();
  showToast("MSR lists restored to defaults");
});
$("kwResetBtn")?.addEventListener("click", async () => {
  const defaults = (page.settings.defaultMsrLists().hints || {}) as Record<string, string[]>;
  for (const [label, chip] of Object.entries(page.kwChips)) {
    chip.setValues(defaults[label] || []);
  }
  showToast("Classifier keywords restored to defaults");
});
page.msrLists.load().then((stored) => fillMsrLists(page, page.settings.msrLists(stored)));
$("clearCacheBtn").addEventListener("click", async () => {
  try {
    await getDefaultDatabase().clearAll();
    await chrome.storage.local.remove([STORAGE.lastRun, STORAGE.lastData]);
    page.bridge.notifyDataUpdated();
    showToast("Pull cache and saved data cleared");
  } catch (e) {
    showToast((e as Error).message, "error");
  }
});

function selectedModel(): MlModelOption {
  const id = $("mlModel").value;
  const found = ML_MODEL_CATALOG.find((m) => m.id === id);
  return found || ML_MODEL_CATALOG[0];
}

async function refreshMlStatus(): Promise<void> {
  const opt = selectedModel();
  const ready = await page.mlModel.matches(opt.spec);
  const s = $("mlStatus");
  if (!s) return;
  s.textContent = ready ? "Model downloaded — ready" : "Not downloaded yet";
  s.classList.toggle("text-good", ready);
  s.classList.toggle("text-dim", !ready);
  $("mlDownloadBtn").disabled = ready;
}

$("mlModel").addEventListener("change", () => {
  // Persist the selection so the viewer/worker use this model, and refresh its
  // download status.
  save().catch((e) => showToast((e as Error).message, "error"));
  refreshMlStatus().catch(() => undefined);
});

$("mlDownloadBtn").addEventListener("click", async () => {
  const btn = $("mlDownloadBtn");
  btn.disabled = true;
  const status = $("mlStatus");
  const spec = selectedModel().spec;
  try {
    status.textContent = "Downloading…";
    const meta = await page.mlModel.download(spec, (p) => {
      if (p.bytes !== undefined && p.bytes >= 0) {
        status.textContent = `Downloading ${p.file} — ${p.bytes}%`;
      } else {
        status.textContent = `Downloading ${p.done}/${p.total}`;
      }
    });
    const verify = await page.mlModel.matches(spec);
    console.log("[settings] ML model download complete, matches=", verify, meta);
    status.textContent = verify
      ? `Model downloaded (${new Date(meta.savedAt).toISOString()})`
      : "Download finished but not verified — retry";
    showToast(verify ? "ML model downloaded and cached" : "Model download incomplete — retry", verify ? "info" : "error");
  } catch (e) {
    status.textContent = "Download failed";
    console.error("[settings] ML model download failed", e);
    showToast((e as Error).message, "error");
  } finally {
    await refreshMlStatus();
  }
});

// The ML toggle and mode persist immediately, so the Data View picks them up
// without requiring a full Save (which many users never press after toggling a
// checkbox).
for (const id of ["mlMode", "mlCacheEnabled"]) {
  $(id).addEventListener("change", () => {
    save().catch((e) => showToast((e as Error).message, "error"));
  });
}

$("mlCacheClearBtn").addEventListener("click", async () => {
  try {
    const { entries } = await page.mlCache.stats();
    await page.mlCache.clear();
    showToast(`Classification cache cleared (${entries} entries removed)`);
  } catch (e) {
    showToast((e as Error).message, "error");
  }
});

refreshMlStatus().catch(() => undefined);
page.settings.load().then(fill);
const CFG_KIND = "servicenow-ticket-analyzer-settings";
const CFG_KEYS = [STORAGE.pluginSettings, STORAGE.exportColMap, STORAGE.ciSplit, STORAGE.viewerHiddenCols, STORAGE.snXlsxTemplate, STORAGE.msrLists];
const CFG_LOCAL_KEY = STORAGE.snFilterList;
function validateCfgKey(key: string, v: unknown): void {
  const bad = (): Error => new Error(`Invalid value for "${key}" in the settings file`);
  if (v === void 0 || v === null) return;
  switch (key) {
    case STORAGE.pluginSettings:
      if (typeof v !== "object" || Array.isArray(v)) throw bad();
      break;
    case STORAGE.viewerHiddenCols:
      if (!Array.isArray(v)) throw bad();
      break;
    case STORAGE.exportColMap:
      if (typeof v !== "object" || Array.isArray(v) || Object.entries(v).some(([a, b]) => typeof a !== "string" || typeof b !== "string")) throw bad();
      break;
    case STORAGE.ciSplit:
      if (typeof v !== "object" || Array.isArray(v) || typeof (v as { enabled?: unknown }).enabled !== "boolean" || !Array.isArray((v as { groups?: unknown }).groups)) throw bad();
      break;
    case STORAGE.msrLists: {
      const isArr = (x: unknown): boolean => Array.isArray(x) && x.every((y) => typeof y === "string");
      if (typeof v !== "object" || Array.isArray(v)) throw bad();
      const lists = (v as { lists?: unknown }).lists;
      if (lists && typeof lists === "object" && !Array.isArray(lists)) {
        for (const k of ["opCo", "domain", "type", "status", "resolution", "duplicate", "queue", "subCategory"]) {
          if ((lists as Record<string, unknown>)[k] !== void 0 && !isArr((lists as Record<string, unknown>)[k])) throw bad();
        }
        const rootCause = (lists as Record<string, unknown>).rootCause;
        if (rootCause !== void 0) {
          if (typeof rootCause !== "object" || Array.isArray(rootCause)) throw bad();
          for (const t of ["Incident", "RFS", "P_Ticket"]) {
            if ((rootCause as Record<string, unknown>)[t] !== void 0 && !isArr((rootCause as Record<string, unknown>)[t])) throw bad();
          }
        }
        const hints = (lists as Record<string, unknown>).hints;
        if (hints !== void 0) {
          if (typeof hints !== "object" || Array.isArray(hints)) throw bad();
          for (const [label, arr] of Object.entries(hints as Record<string, unknown>)) {
            if (typeof label !== "string" || !isArr(arr)) throw bad();
          }
        }
      }
      break;
    }
    case STORAGE.snXlsxTemplate:
      if (typeof v !== "object" || Array.isArray(v) || typeof (v as { name?: unknown }).name !== "string" || typeof (v as { dataB64?: unknown }).dataB64 !== "string") throw bad();
      break;
    case STORAGE.snFilterList:
      if (!Array.isArray(v) || v.some((f) => typeof f !== "object" || f === null)) throw bad();
      break;
  }
}
let filterListRaw = "[]";
try {
  filterListRaw = localStorage.getItem(CFG_LOCAL_KEY) || "[]";
} catch {
}
function exportFilterList(): unknown[] {
  try {
    return JSON.parse(filterListRaw);
  } catch {
    return [];
  }
}
function importFilterList(arr: unknown): void {
  if (!Array.isArray(arr)) return;
  filterListRaw = JSON.stringify(arr);
  try {
    localStorage.setItem(CFG_LOCAL_KEY, filterListRaw);
  } catch {
  }
}
$("exportCfgBtn").addEventListener("click", async () => {
  try {
    const cfg = await chrome.storage.local.get(CFG_KEYS);
    const payload = {
      kind: CFG_KIND,
      version: 1,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      settings: {
        ...Object.fromEntries(CFG_KEYS.map((k) => [k, cfg[k] ?? null])),
        [CFG_LOCAL_KEY]: exportFilterList()
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `snow-analyzer-settings-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 16).replace(/[-:T]/g, "")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4e3);
    showToast("Backup exported");
  } catch (err) {
    showToast((err as Error).message, "error");
  }
});
$("importCfgBtn").addEventListener("click", () => $("cfgFile").click());
$("cfgFile").addEventListener("change", async (e: Event) => {
  const input = e.target as HTMLInputElement | null;
  const f = input && input.files && input.files[0];
  if (input) input.value = "";
  if (!f) return;
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await f.text());
    } catch {
      throw new Error("Not a valid JSON file");
    }
    const p = parsed as { kind?: unknown; settings?: unknown };
    if (!p || !p.settings || typeof p.settings !== "object") {
      throw new Error("This file is not a ServiceNow Analyzer settings export");
    }
    const updates: Record<string, unknown> = {};
    for (const key of CFG_KEYS) {
      const v = (p.settings as Record<string, unknown>)[key];
      if (v === void 0 || v === null) continue;
      validateCfgKey(key, v);
      updates[key] = v;
    }
    const localVal = (p.settings as Record<string, unknown>)[CFG_LOCAL_KEY];
    if (localVal !== void 0 && localVal !== null) validateCfgKey(CFG_LOCAL_KEY, localVal);
    const allKeys = [...Object.keys(updates), ...localVal != null ? [CFG_LOCAL_KEY] : []];
    if (!allKeys.length) throw new Error("The file contains none of the expected settings");
    const ok = confirm(
      `Replace current configuration with the file's values?

Replaces: ${allKeys.join(", ")}

Current queues, filters, mapping and split groups will be overwritten.`
    );
    if (!ok) return;
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
    if (localVal != null) importFilterList(localVal);
    page.bridge.notifyDataUpdated();
    fill(updates.pluginSettings ?? null);
    showToast("Settings imported");
  } catch (err) {
    showToast((err as Error).message, "error");
  }
});
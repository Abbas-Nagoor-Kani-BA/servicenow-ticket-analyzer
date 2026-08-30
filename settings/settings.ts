import { getDefaultDatabase } from "../data/idb.ts";
import { STORAGE } from "../lib/keys.ts";
import { showToast } from "../lib/toast.ts";
import { initTooltips } from "../lib/tooltip.ts";
import { createSettings, fillMsrLists, collectMsrLists } from "../surfaces/settings/index.ts";
import { normaliseSettings } from "../services/settings-service.ts";

import type { SettingsDraft } from "../services/settings-service.ts";

const $ = (id: string): any => document.getElementById(id);

const page = createSettings();

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
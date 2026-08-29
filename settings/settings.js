import { clearAll } from "../lib/cache.js";
import { MSR_DEFAULT_LISTS, mergeMsrLists } from "../lib/msrchoices.js";
import { STORAGE, MSG } from "../lib/keys.js";
import { broadcast } from "../lib/storage.js";
import { createChipList } from "./chips.js";
import { showToast } from "../lib/toast.js";
import { initTooltips } from "../lib/tooltip.js";

/** @param {string} id @returns {any} */
const $ = id => document.getElementById(id);

const DEFAULTS = {
  version: 2,
  instanceUrl: "",
  defaults: {
    ticketType: "incident",
    queues: [],
    teamMembers: []
  },
  params: {
    tablePageSize: 1e3,
    debugResponses: false,
    cacheTtlMinutes: 15,
    maxTicketsPerPull: 500
  }
};
const TICKET_TYPES = ["incident", "change_request", "problem", "sc_req_item", "sc_task"];
const MSR_LIST_FIELDS = [
  ["opCo", "msrOpCo"],
  ["domain", "msrDomain"],
  ["type", "msrType"],
  ["status", "msrStatus"],
  ["resolution", "msrResolution"],
  ["duplicate", "msrDuplicate"],
  ["queue", "msrQueue"],
  ["subCategory", "msrSubCategory"]
];
const MSR_RC_FIELDS = [
  ["Incident", "msrRcIncident"],
  ["RFS", "msrRcRfs"],
  ["P_Ticket", "msrRcPTicket"]
];
function chipsFor(id) {
  return createChipList($(id), { collapsible: true });
}
function fillMsrLists(lists) {
  for (const [key, id] of MSR_LIST_FIELDS) chipsFor(id).setValues(lists[key] || []);
  for (const [key, id] of MSR_RC_FIELDS) chipsFor(id).setValues((lists.rootCause || {})[key] || []);
}
function collectMsrLists() {
  const lists = {};
  for (const [key, id] of MSR_LIST_FIELDS) lists[key] = chipsFor(id).getValues();
  const rootCause = {};
  for (const [key, id] of MSR_RC_FIELDS) rootCause[key] = chipsFor(id).getValues();
  lists.rootCause = rootCause;
  return { version: 2, lists };
}
function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}
function collect() {
  return {
    version: 2,
    instanceUrl: $("instanceUrl").value.trim().replace(/\/+$/, ""),
    defaults: {
      ticketType: TICKET_TYPES.includes($("ticketType").value) ? $("ticketType").value : "incident",
      queues: chipsFor("queuesChips").getValues(),
      teamMembers: chipsFor("teamMembersChips").getValues()
    },
    params: {
      tablePageSize: clampInt($("tablePageSize").value, 100, 5e3, DEFAULTS.params.tablePageSize),
      debugResponses: !!$("debugResponses").checked,
      cacheTtlMinutes: clampInt($("cacheTtlMinutes").value, 0, 10080, DEFAULTS.params.cacheTtlMinutes),
      maxTicketsPerPull: clampInt($("maxTicketsPerPull").value, 0, 1e5, DEFAULTS.params.maxTicketsPerPull)
    }
  };
}
function fill(s) {
  const merged = structuredClone(DEFAULTS);
  if (s && typeof s === "object") {
    if (typeof s.instanceUrl === "string") merged.instanceUrl = s.instanceUrl;
    if (s.defaults && typeof s.defaults === "object") {
      Object.assign(merged.defaults, s.defaults);
      if (!Array.isArray(merged.defaults.queues) || !merged.defaults.queues.length) {
        if (typeof s.defaults.queueName === "string" && s.defaults.queueName) {
          merged.defaults.queues = [s.defaults.queueName];
        }
      }
    }
    if (s.params && typeof s.params === "object") Object.assign(merged.params, s.params);
  }
  $("instanceUrl").value = merged.instanceUrl;
  $("ticketType").value = TICKET_TYPES.includes(merged.defaults.ticketType) ? merged.defaults.ticketType : "incident";
  chipsFor("queuesChips").setValues(merged.defaults.queues);
  chipsFor("teamMembersChips").setValues(merged.defaults.teamMembers);
  $("tablePageSize").value = merged.params.tablePageSize;
  $("debugResponses").checked = !!merged.params.debugResponses;
  $("cacheTtlMinutes").value = merged.params.cacheTtlMinutes;
  $("maxTicketsPerPull").value = merged.params.maxTicketsPerPull;
}
async function save() {
  const settings = collect();
  const msr = collectMsrLists();
  await chrome.storage.local.set({ [STORAGE.pluginSettings]: settings, [STORAGE.msrLists]: msr });
  const q = settings.defaults.queues.length;
  const m = settings.defaults.teamMembers.length;
  showToast(`Settings saved \u2014 ${q} queue${q === 1 ? "" : "s"}, ${m} member${m === 1 ? "" : "s"}`);
}
$("saveBtn").addEventListener("click", () => save().catch((e) => showToast(e.message, "error")));
initTooltips();
$("resetBtn").addEventListener("click", async () => {
  fill(null);
  await chrome.storage.local.set({ [STORAGE.pluginSettings]: collect() });
  showToast("Settings reset to defaults");
});
$("msrResetBtn").addEventListener("click", async () => {
  fillMsrLists(MSR_DEFAULT_LISTS);
  await chrome.storage.local.remove(STORAGE.msrLists);
  showToast("MSR lists restored to defaults");
});
chrome.storage.local.get([STORAGE.msrLists], ({ msrLists }) => {
  fillMsrLists(mergeMsrLists(msrLists && msrLists.lists ? msrLists.lists : null));
});
$("clearCacheBtn").addEventListener("click", async () => {
  try {
    await clearAll();
    await chrome.storage.local.remove([STORAGE.lastRun, STORAGE.lastData]);
    broadcast({ type: MSG.dataUpdated });
    showToast("Pull cache and saved data cleared");
  } catch (e) {
    showToast(e.message, "error");
  }
});
chrome.storage.local.get([STORAGE.pluginSettings], ({ pluginSettings }) => fill(pluginSettings));
const CFG_KIND = "servicenow-ticket-analyzer-settings";
const CFG_KEYS = [STORAGE.pluginSettings, STORAGE.exportColMap, STORAGE.ciSplit, STORAGE.viewerHiddenCols, STORAGE.snXlsxTemplate, STORAGE.msrLists];
const CFG_LOCAL_KEY = STORAGE.snFilterList;
function validateCfgKey(key, v) {
  const bad = () => new Error(`Invalid value for "${key}" in the settings file`);
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
      if (typeof v !== "object" || Array.isArray(v) || typeof v.enabled !== "boolean" || !Array.isArray(v.groups)) throw bad();
      break;
    case STORAGE.msrLists: {
      const isArr = (x) => Array.isArray(x) && x.every((y) => typeof y === "string");
      if (typeof v !== "object" || Array.isArray(v)) throw bad();
      if (v.lists && typeof v.lists === "object" && !Array.isArray(v.lists)) {
        for (const k of ["opCo", "domain", "type", "status", "resolution", "duplicate", "queue", "subCategory"]) {
          if (v.lists[k] !== void 0 && !isArr(v.lists[k])) throw bad();
        }
        if (v.lists.rootCause !== void 0) {
          if (typeof v.lists.rootCause !== "object" || Array.isArray(v.lists.rootCause)) throw bad();
          for (const t of ["Incident", "RFS", "P_Ticket"]) {
            if (v.lists.rootCause[t] !== void 0 && !isArr(v.lists.rootCause[t])) throw bad();
          }
        }
      }
      break;
    }
    case STORAGE.snXlsxTemplate:
      if (typeof v !== "object" || Array.isArray(v) || typeof v.name !== "string" || typeof v.dataB64 !== "string") throw bad();
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
function exportFilterList() {
  try {
    return JSON.parse(filterListRaw);
  } catch {
    return [];
  }
}
function importFilterList(arr) {
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
    showToast(err.message, "error");
  }
});
$("importCfgBtn").addEventListener("click", () => $("cfgFile").click());
$("cfgFile").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    let parsed;
    try {
      parsed = JSON.parse(await f.text());
    } catch {
      throw new Error("Not a valid JSON file");
    }
    if (!parsed || parsed.kind !== CFG_KIND || !parsed.settings || typeof parsed.settings !== "object") {
      throw new Error("This file is not a ServiceNow Analyzer settings export");
    }
    const updates = {};
    for (const key of CFG_KEYS) {
      const v = parsed.settings[key];
      if (v === void 0 || v === null) continue;
      validateCfgKey(key, v);
      updates[key] = v;
    }
    const localVal = parsed.settings[CFG_LOCAL_KEY];
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
    broadcast({ type: MSG.dataUpdated });
    fill(updates.pluginSettings ?? null);
    showToast("Settings imported");
  } catch (err) {
    showToast(err.message, "error");
  }
});

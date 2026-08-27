import { clearAll } from "../lib/cache.js";
import { MSR_DEFAULT_LISTS, mergeMsrLists } from "../lib/msrchoices.js";

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
function fillMsrLists(lists) {
  for (const [key, id] of MSR_LIST_FIELDS) $(id).value = (lists[key] || []).join("\n");
  for (const [key, id] of MSR_RC_FIELDS) $(id).value = ((lists.rootCause || {})[key] || []).join("\n");
}
function collectMsrLists() {
  const lists = {};
  for (const [key, id] of MSR_LIST_FIELDS) lists[key] = parseNameLines($(id).value);
  const rootCause = {};
  for (const [key, id] of MSR_RC_FIELDS) rootCause[key] = parseNameLines($(id).value);
  lists.rootCause = rootCause;
  return { version: 2, lists };
}
function clampInt(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}
function parseNameLines(text) {
  const seen = /* @__PURE__ */ new Set();
  return String(text).split("\n").map((s) => s.replace(/\s*[|=]\s*.*$/, "").trim()).filter(Boolean).filter((n) => seen.has(n.toLowerCase()) ? false : (seen.add(n.toLowerCase()), true));
}
function formatNames(arr) {
  return (arr || []).map((p) => typeof p === "string" ? p : p?.name || "").filter(Boolean).join("\n");
}
function collect() {
  return {
    version: 2,
    instanceUrl: $("instanceUrl").value.trim().replace(/\/+$/, ""),
    defaults: {
      ticketType: TICKET_TYPES.includes($("ticketType").value) ? $("ticketType").value : "incident",
      queues: parseNameLines($("queues").value),
      teamMembers: parseNameLines($("teamMembers").value)
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
  $("queues").value = formatNames(merged.defaults.queues);
  $("teamMembers").value = formatNames(merged.defaults.teamMembers);
  $("tablePageSize").value = merged.params.tablePageSize;
  $("debugResponses").checked = !!merged.params.debugResponses;
  $("cacheTtlMinutes").value = merged.params.cacheTtlMinutes;
  $("maxTicketsPerPull").value = merged.params.maxTicketsPerPull;
}
function setStatus(text, isError = false) {
  const el = $("status");
  el.textContent = text;
  el.style.color = isError ? "#f38ba8" : "#a6e3a1";
  setTimeout(() => {
    el.textContent = "";
  }, 3500);
}
async function save() {
  const settings = collect();
  const msr = collectMsrLists();
  await chrome.storage.local.set({ pluginSettings: settings, msrLists: msr });
  const q = settings.defaults.queues.length;
  const m = settings.defaults.teamMembers.length;
  setStatus(`Saved \u2014 ${q} queue${q === 1 ? "" : "s"}, ${m} member${m === 1 ? "" : "s"}, MSR lists updated`);
}
$("saveBtn").addEventListener("click", () => save().catch((e) => setStatus(e.message, true)));
$("resetBtn").addEventListener("click", async () => {
  fill(null);
  await chrome.storage.local.set({ pluginSettings: collect() });
  setStatus("Reset to defaults");
});
$("msrResetBtn").addEventListener("click", async () => {
  fillMsrLists(MSR_DEFAULT_LISTS);
  await chrome.storage.local.remove("msrLists");
  setStatus("MSR lists restored to defaults");
});
chrome.storage.local.get(["msrLists"], ({ msrLists }) => {
  fillMsrLists(mergeMsrLists(msrLists && msrLists.lists ? msrLists.lists : null));
});
$("clearCacheBtn").addEventListener("click", async () => {
  try {
    await clearAll();
    setStatus("Pull cache cleared");
  } catch (e) {
    setStatus(e.message, true);
  }
});
chrome.storage.local.get(["pluginSettings"], ({ pluginSettings }) => fill(pluginSettings));
const CFG_KIND = "servicenow-ticket-analyzer-settings";
const CFG_KEYS = ["pluginSettings", "exportColMap", "ciSplit", "viewerHiddenCols", "snXlsxTemplate", "msrLists"];
const CFG_LOCAL_KEY = "snFilterList";
function validateCfgKey(key, v) {
  const bad = () => new Error(`Invalid value for "${key}" in the settings file`);
  if (v === void 0 || v === null) return;
  switch (key) {
    case "pluginSettings":
      if (typeof v !== "object" || Array.isArray(v)) throw bad();
      break;
    case "viewerHiddenCols":
      if (!Array.isArray(v)) throw bad();
      break;
    case "exportColMap":
      if (typeof v !== "object" || Array.isArray(v) || Object.entries(v).some(([a, b]) => typeof a !== "string" || typeof b !== "string")) throw bad();
      break;
    case "ciSplit":
      if (typeof v !== "object" || Array.isArray(v) || typeof v.enabled !== "boolean" || !Array.isArray(v.groups)) throw bad();
      break;
    case "msrLists": {
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
    case "snXlsxTemplate":
      if (typeof v !== "object" || Array.isArray(v) || typeof v.name !== "string" || typeof v.dataB64 !== "string") throw bad();
      break;
    case "snFilterList":
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
    setStatus(`Exported ${a.download}`);
  } catch (err) {
    setStatus(err.message, true);
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
    chrome.runtime.sendMessage({ type: "DATA_UPDATED" }).catch(() => {
    });
    fill(updates.pluginSettings ?? null);
    setStatus("Settings imported");
  } catch (err) {
    setStatus(err.message, true);
  }
});

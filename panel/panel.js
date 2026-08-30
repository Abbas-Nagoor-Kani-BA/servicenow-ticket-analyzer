import { buildEncodedQuery } from "../core/querybuilder.js";
import { snStateChoices, SN_PRIORITY_CHOICES, snTableLabel } from "../core/statechoices.js";
import { STORAGE, MSG } from "../lib/keys.ts";
import { createPanel, describeFilterSet } from "../surfaces/panel/index.ts";
import { broadcast } from "../lib/storage.js";
import { showToast } from "../lib/toast.js";
import { initTooltips } from "../lib/tooltip.js";

/** @param {string} id @returns {any} */
const $ = id => document.getElementById(id);

const els = {
  instance: $("instance"),
  connect: $("connectBtn"),
  connState: $("connState"),
  ticketType: $("ticketType"),
  rawQuery: $("rawQuery"),
  generatedQuery: $("generatedQuery"),
  advancedBox: $("advancedBox"),
  preview: $("previewBtn"),
  runBtn: $("runBtn"),
  viewBtn: $("viewBtn"),
  lastRun: $("lastRun")
};
function choiceList(key) {
  if (key === "states") return snStateChoices(els.ticketType.value);
  if (key === "incidentStates") return snStateChoices("incident");
  if (key === "priorities") return SN_PRIORITY_CHOICES;
  return [];
}
/** @type {{key:string,label:string,field:string,type:"ref"|"string"|"choice"|"date",choicesKey?:string,tables?:string[]}[]} */
const COND_FIELDS = [
  { key: "assignedTo", label: "Assigned to", field: "assigned_to", type: "ref" },
  { key: "parentIncident", label: "Parent incident", field: "u_parent_incident1", type: "ref", tables: ["incident"] },
  { key: "state", label: "State", field: "state", type: "choice", choicesKey: "states" },
  { key: "priority", label: "Priority", field: "priority", type: "choice", choicesKey: "priorities" },
  { key: "incidentState", label: "Incident state", field: "incident_state", type: "choice", choicesKey: "incidentStates", tables: ["incident"] },
  { key: "group", label: "Group", field: "assignment_group", type: "ref" },
  { key: "configItem", label: "Configuration item", field: "cmdb_ci.name", type: "string" },
  { key: "shortDescription", label: "Short description", field: "short_description", type: "string" },
  { key: "number", label: "Number", field: "number", type: "string" },
  { key: "createdOn", label: "Created", field: "sys_created_on", type: "date" },
  { key: "closedOn", label: "Closed", field: "closed_at", type: "date", tables: ["incident", "problem", "sc_req_item", "sc_task"] },
  { key: "resolvedOn", label: "Resolved", field: "resolved_at", type: "date", tables: ["incident", "problem", "sc_req_item"] }
];

const panel = createPanel({
  condFields: COND_FIELDS,
  choiceList: (key) => choiceList(key),
  onConditionChange: () => refreshGenerated(),
  onFilterSetChange: () => refreshGenerated()
});
const { logCard, progressCard, conditions, filterSets } = panel;
const logger = { log: (text, level) => logCard.log(text, level || "") };
let busy = false;
let cfgQueues = [];
let cfgMembers = [];
const toEntry = (m) => {
  if (typeof m === "string") return { name: m, sysId: "" };
  if (m && typeof m === "object" && m.name) return { name: String(m.name), sysId: String(m.sysId || "") };
  return null;
};
function legacySnGroupQueues() {
  try {
    const raw = localStorage.getItem("snGroup");
    if (!raw) return [];
    const p = JSON.parse(raw);
    const arr = Array.isArray(p) ? p : [p];
    return arr.filter(Boolean).map((v) => ({ name: String(v), sysId: "" }));
  } catch {
    return [];
  }
}
async function applyPluginSettings() {
  const { pluginSettings: s } = await chrome.storage.local.get(STORAGE.pluginSettings);
  if (s) {
    if (!els.instance.value && s.instanceUrl) els.instance.value = s.instanceUrl;
    if (s.defaults?.ticketType && [...els.ticketType.options].some((o) => o.value === s.defaults.ticketType)) {
      els.ticketType.value = s.defaults.ticketType;
    }
    const rawQueues = Array.isArray(s.defaults?.queues) && s.defaults.queues.length ? s.defaults.queues : s.defaults?.queueName ? [{ name: s.defaults.queueName, sysId: "" }] : legacySnGroupQueues();
    cfgQueues = rawQueues.map(toEntry).filter(Boolean);
    cfgMembers = (Array.isArray(s.defaults?.teamMembers) ? s.defaults.teamMembers : []).map(toEntry).filter(Boolean);
  }
  conditions.setTable(els.ticketType.value);
  refreshGenerated();
}
$("settingsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
initTooltips();
panel.ready.then(() => refreshGenerated()).catch(() => {});
chrome.storage.local.get(["snInstance", "lastRun"], async (cfg) => {
  await applyPluginSettings();
  if (cfg.snInstance && !els.instance.value) els.instance.value = cfg.snInstance;
  const effective = els.instance.value || cfg.snInstance;
  if (effective) {
    els.instance.value = effective;
    refreshGenerated();
    connect();
  } else {
    const detected = await detectInstanceFromTabs();
    if (detected) {
      els.instance.value = detected;
      logger.log(`Detected instance from open tab: ${detected}`);
      connect();
    }
  }
  if (cfg.lastRun) {
    els.lastRun.textContent = `Last export: ${cfg.lastRun.tickets} tickets for "${cfg.lastRun.group}" \xB7 ${cfg.lastRun.at.slice(0, 16).replace("T", " ")}`;
  }
});
chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local") {
    if (ch.pluginSettings) applyPluginSettings();
    if (ch.lastRun) {
      const cfg = ch.lastRun.newValue;
      if (cfg) {
        els.lastRun.textContent = `Last run: ${cfg.tickets} tickets for "${cfg.group}" \xB7 ${cfg.at.slice(0, 16).replace("T", " ")}`;
      } else {
        els.lastRun.textContent = "";
      }
    }
  }
});
async function detectInstanceFromTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: "https://*.service-now.com/*" });
    if (!tabs.length) return null;
    const recent = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    return new URL(recent.url).origin;
  } catch {
    return null;
  }
}
function instanceUrl() {
  return els.instance.value.trim();
}
$("addFilterBtn").addEventListener("click", async () => {
  try {
    const f = currentFilters();
    delete f.onlyMyQueue;
    delete f.rawQuery;
    const outcome = await filterSets.add(f);
    if (outcome === "duplicate") {
      logger.log("This exact filter set is already in the list");
      return;
    }
    conditions.setRows([]);
    refreshGenerated();
    filterSets.flash();
    const total = filterSets.getSets().length;
    logger.log(`Added filter ${total}: ${describeFilterSet(f, COND_FIELDS, (k) => choiceList(k))}`, "success");
    showToast(`Filter ${total} added`);
  } catch (err) {
    logger.log(err.message, "error");
    showToast(err.message, "error");
  }
});
$("clearFilterListBtn").addEventListener("click", async () => {
  await filterSets.clear();
  refreshGenerated();
});
function requireInstance() {
  const url = instanceUrl();
  if (!/^https:\/\/.+/.test(url)) throw new Error("Enter a valid https instance URL");
  return url;
}
function currentFilters() {
  return {
    table: els.ticketType.value,
    conditions: conditions.conditions(),
    rawQuery: els.rawQuery.value
  };
}
function configuredGroups() {
  if (!cfgQueues.length) throw new Error("No queues configured \u2014 open Settings and add assignment group names, one per line");
  const badComma = cfgQueues.find((g) => String(g).includes(","));
  if (badComma) throw new Error(`Queue name "${badComma}" contains a comma \u2014 rename it in Settings`);
  return cfgQueues;
}
function savePrefs() {
  chrome.storage.local.set({ snInstance: instanceUrl() });
}
function send(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}
async function connect(manual = false) {
  try {
    requireInstance();
    els.connect.disabled = true;
    els.connState.textContent = "Checking\u2026";
    els.connState.classList.remove("on");
    const groups = configuredGroups();
    els.connState.textContent = `Ready \xB7 ${groups.length} queue${groups.length > 1 ? "s" : ""}`;
    els.connState.classList.add("on");
    logger.log(
      `Ready (no setup server calls): ${groups.length} queue(s), ${cfgMembers.length} team member(s) from settings`,
      "success"
    );
    if (manual) showToast(`Ready \u2014 ${groups.length} queue${groups.length > 1 ? "s" : ""}, ${cfgMembers.length} member${cfgMembers.length > 1 ? "s" : ""}`);
    savePrefs();
    refreshGenerated();
  } catch (err) {
    els.connState.textContent = "Not ready";
    els.connState.classList.remove("on");
    logger.log(err.message, "error");
    if (manual) showToast(err.message, "error");
  } finally {
    els.connect.disabled = false;
  }
}
function refreshGenerated() {
  try {
    const q = buildEncodedQuery(currentFilters());
    els.generatedQuery.textContent = q || `(no filters \u2014 all ${snTableLabel(els.ticketType.value)} you can read)`;
  } catch (e) {
    els.generatedQuery.textContent = e.message;
  }
}
["change", "input"].forEach((ev) => {
  [els.ticketType].forEach(
    (el) => el.addEventListener(ev, () => {
      refreshGenerated();
    })
  );
});
els.rawQuery.addEventListener("input", refreshGenerated);
els.ticketType.addEventListener("change", () => {
  conditions.setTable(els.ticketType.value);
  refreshGenerated();
});
els.connect.addEventListener("click", () => connect(true));
els.instance.addEventListener("change", () => {
  els.connState.textContent = "Not ready";
  els.connState.classList.remove("on");
});
function setBusy(state) {
  busy = state;
  els.preview.disabled = state;
  els.runBtn.disabled = state;
  if (state) progressCard.begin();
  else progressCard.end();
}
els.preview.addEventListener("click", async () => {
  try {
    setBusy(true);
    progressCard.setLabel("Counting\u2026");
    const instanceUrl2 = requireInstance();
    const groups = configuredGroups();
    const live = currentFilters();
    const saved = filterSets.getSets();
    const sets = saved.length ? saved.map((f) => ({ ...f, rawQuery: live.rawQuery })) : [live];
    let pullable = 0;
    let overLimit = 0;
    let lastQuery = "";
    for (let i = 0; i < sets.length; i++) {
      const res = await send({
        type: MSG.count,
        instanceUrl: instanceUrl2,
        groups,
        filters: sets[i]
      });
      if (!res.ok) throw new Error(res.error);
      lastQuery = res.encodedQuery || lastQuery;
      const label = sets.length > 1 ? `Preview set ${i + 1}/${sets.length}` : "Preview";
      logger.log(`${label}: ${res.total} tickets match`);
      if (res.limit > 0 && res.total > res.limit) {
        overLimit++;
        logger.log(`${label}: ${res.total} tickets EXCEEDS the max-tickets limit (${res.limit}) \u2014 this set will be SKIPPED on run. Narrow it or raise the limit in Settings`, "error");
      } else {
        pullable += res.total;
      }
    }
    progressCard.setLabel(overLimit ? `${pullable} pullable \xB7 ${overLimit} set(s) skipped by limit` : `${pullable} matching ticket${pullable === 1 ? "" : "s"}`);
    showToast(`Preview \u2014 ${pullable} matching ticket${pullable === 1 ? "" : "s"}`);
    if (lastQuery) logger.log(`Query: ${lastQuery}`);
  } catch (err) {
    progressCard.setLabel(err.message);
    logger.log(err.message, "error");
    showToast(err.message, "error");
  } finally {
    setBusy(false);
  }
});
els.runBtn.addEventListener("click", async () => {
  try {
    if (busy) return;
    setBusy(true);
    const live = currentFilters();
    const saved = filterSets.getSets();
    const sets = saved.length ? saved.map((f) => ({ ...f, rawQuery: live.rawQuery })) : [live];
    await send({
      type: MSG.run,
      instanceUrl: requireInstance(),
      groups: configuredGroups(),
      filters: sets[0],
      filterSets: sets
    });
    logger.log(`Run started with ${sets.length} filter set${sets.length > 1 ? "s" : ""}\u2026`);
  } catch (err) {
    setBusy(false);
    progressCard.setLabel(err.message);
    logger.log(err.message, "error");
    showToast(err.message, "error");
  }
});
$("viewBtn").addEventListener("click", () => {
  els.viewBtn.classList.remove("attention");
  openViewer();
});
let viewerTabId = null;
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === viewerTabId) viewerTabId = null;
});
async function openViewer() {
  const url = chrome.runtime.getURL("viewer/viewer.html");
  if (viewerTabId !== null) {
    try {
      const tab2 = await chrome.tabs.get(viewerTabId);
      await chrome.tabs.update(tab2.id, { active: true });
      await chrome.windows.update(tab2.windowId, { focused: true });
      broadcast({ type: MSG.dataUpdated });
      return;
    } catch {
      viewerTabId = null;
    }
  }
  const tab = await chrome.tabs.create({ url });
  viewerTabId = tab.id;
}
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== MSG.progress) return;
  const detail = String(msg.detail ?? "");
  const level = progressCard.apply(msg);

  if (msg.stage === "diag") {
    logger.log(detail, level === "error" ? "error" : "");
    return;
  }
  if (level === "error") {
    logger.log(detail, "error");
    showToast(detail, "error");
    setBusy(false);
    return;
  }
  if (msg.stage === "done") {
    logger.log(detail, "success");
    showToast(`Run complete \u2014 ${msg.pulled ?? 0} ticket${msg.pulled === 1 ? "" : "s"} pulled`);
    setBusy(false);
    els.viewBtn.classList.add("attention");
    chrome.storage.local.get(["lastRun"], (cfg) => {
      if (cfg.lastRun) {
        els.lastRun.textContent = `Last run: ${cfg.lastRun.tickets} tickets for "${cfg.lastRun.group}" \xB7 ${cfg.lastRun.at.slice(0, 16).replace("T", " ")}`;
      }
    });
    return;
  }
  logger.log(detail);
});


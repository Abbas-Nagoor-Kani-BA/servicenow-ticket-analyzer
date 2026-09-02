import { buildEncodedQuery } from "../core/querybuilder.ts";
import { snStateChoices, SN_PRIORITY_CHOICES, snTableLabel } from "../core/statechoices.ts";
import { STORAGE } from "../lib/keys.ts";
import { createPanel, describeFilterSet } from "../surfaces/panel/index.ts";
import { showToast } from "../lib/toast.ts";
import { initTooltips } from "../lib/tooltip.ts";

import type { CondFieldDef } from "../components/condition-builder.ts";
import type { LogLevel } from "../components/log-card.ts";
import type { MsgProgress } from "../types/global.d.ts";

const $ = (id: string): any => document.getElementById(id);

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
function choiceList(key: string): { value: string | number; label: string }[] {
  if (key === "states") return snStateChoices(els.ticketType.value);
  if (key === "incidentStates") return snStateChoices("incident");
  if (key === "priorities") return SN_PRIORITY_CHOICES;
  return [];
}
const COND_FIELDS: CondFieldDef[] = [
  { key: "assignedTo", label: "Assigned to", field: "assigned_to", type: "ref" },
  { key: "parentIncident", label: "Parent incident", field: "parent_incident", type: "ref", tables: ["incident"] },
  { key: "state", label: "State", field: "state", type: "choice", choicesKey: "states", fieldByTable: { problem: "problem_state" } },
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
const { logCard, progressCard, conditions, filterSets, bridge } = panel;
const logger = { log: (text: string, level?: LogLevel) => logCard.log(text, level || "") };
let busy = false;
type Entry = { name: string; sysId: string };
type PanelCond = { join: string; field: string; oper: string; value: string; value2: string };
let cfgQueues: Entry[] = [];
let cfgMembers: Entry[] = [];
const toEntry = (m: unknown): Entry | null => {
  if (typeof m === "string") return { name: m, sysId: "" };
  if (m && typeof m === "object" && typeof (m as { name?: unknown }).name === "string") {
    return { name: String((m as { name: unknown }).name), sysId: String((m as { name: unknown; sysId?: unknown }).sysId || "") };
  }
  return null;
};
const asEntries = (raw: unknown[]): Entry[] => raw.map(toEntry).filter((x): x is Entry => x !== null);
function legacySnGroupQueues(): Entry[] {
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
async function applyPluginSettings(): Promise<void> {
  const { pluginSettings: s } = await chrome.storage.local.get(STORAGE.pluginSettings);
  if (s) {
    const settings = s as {
      instanceUrl?: unknown;
      defaults?: {
        ticketType?: unknown;
        queues?: unknown[];
        queueName?: unknown;
        teamMembers?: unknown[];
      };
    };
    if (!els.instance.value && settings.instanceUrl) els.instance.value = String(settings.instanceUrl);
    if (settings.defaults?.ticketType && [...els.ticketType.options].some((o) => o.value === settings.defaults?.ticketType)) {
      els.ticketType.value = String(settings.defaults.ticketType);
    }
    const rawQueues =
      Array.isArray(settings.defaults?.queues) && settings.defaults!.queues!.length
        ? settings.defaults!.queues!
        : settings.defaults?.queueName
          ? [{ name: String(settings.defaults.queueName), sysId: "" }]
          : legacySnGroupQueues();
    cfgQueues = asEntries(rawQueues);
    cfgMembers = asEntries(Array.isArray(settings.defaults?.teamMembers) ? (settings.defaults!.teamMembers! as unknown[]) : []);
  }
  conditions.setTable(els.ticketType.value);
  refreshGenerated();
}
$("settingsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
initTooltips();
panel.ready.then(() => refreshGenerated()).catch(() => {});
chrome.storage.local.get(["snInstance", "lastRun"], async (cfg: { snInstance?: unknown; lastRun?: unknown }) => {
  await applyPluginSettings();
  if (cfg.snInstance && !els.instance.value) els.instance.value = String(cfg.snInstance);
  const effective = els.instance.value || cfg.snInstance;
  if (effective) {
    els.instance.value = String(effective);
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
    const lastRun = cfg.lastRun as { tickets?: unknown; group?: unknown; at?: string };
    els.lastRun.textContent = `Last export: ${lastRun.tickets} tickets for "${lastRun.group}" \xB7 ${String(lastRun.at).slice(0, 16).replace("T", " ")}`;
  }
});
chrome.storage.onChanged.addListener((ch: Record<string, { newValue?: unknown }>, area: string) => {
  if (area === "local") {
    if (ch.pluginSettings) applyPluginSettings();
    if (ch.lastRun) {
      const cfg = ch.lastRun.newValue as { tickets?: unknown; group?: unknown; at?: string } | undefined;
      if (cfg) {
        els.lastRun.textContent = `Last run: ${cfg.tickets} tickets for "${cfg.group}" \xB7 ${String(cfg.at).slice(0, 16).replace("T", " ")}`;
      } else {
        els.lastRun.textContent = "";
      }
    }
  }
});
async function detectInstanceFromTabs(): Promise<string | null> {
  try {
    const tabs = await chrome.tabs.query({ url: "https://*.service-now.com/*" });
    if (!tabs.length) return null;
    type RecentTab = { lastAccessed?: number; url?: string };
    const recent = tabs.sort((a: RecentTab, b: RecentTab) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    return new URL(recent.url).origin;
  } catch {
    return null;
  }
}
function instanceUrl(): string {
  return els.instance.value.trim();
}
$("addFilterBtn").addEventListener("click", async () => {
  try {
    const f = currentFilters();
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
    logger.log((err as Error).message, "error");
    showToast((err as Error).message, "error");
  }
});
$("clearFilterListBtn").addEventListener("click", async () => {
  await filterSets.clear();
  refreshGenerated();
});
function requireInstance(): string {
  const url = instanceUrl();
  if (!/^https:\/\/.+/.test(url)) throw new Error("Enter a valid https instance URL");
  return url;
}
type PanelFilters = { table: string; conditions: PanelCond[]; rawQuery?: string };
function currentFilters(): PanelFilters {
  return {
    table: els.ticketType.value,
    conditions: conditions.conditions() as PanelCond[],
    rawQuery: els.rawQuery.value
  };
}
function configuredGroups(): string[] {
  if (!cfgQueues.length) throw new Error("No queues configured \u2014 open Settings and add assignment group names, one per line");
  const badComma = cfgQueues.find((g) => g.name.includes(","));
  if (badComma) throw new Error(`Queue name "${badComma.name}" contains a comma \u2014 rename it in Settings`);
  return cfgQueues.map((g) => g.name);
}
function savePrefs(): void {
  chrome.storage.local.set({ snInstance: instanceUrl() });
}
async function connect(manual = false): Promise<void> {
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
    logger.log((err as Error).message, "error");
    if (manual) showToast((err as Error).message, "error");
  } finally {
    els.connect.disabled = false;
  }
}
function refreshGenerated(): void {
  try {
    const q = buildEncodedQuery(currentFilters());
    els.generatedQuery.textContent = q || `(no filters \u2014 all ${snTableLabel(els.ticketType.value)} you can read)`;
  } catch (e) {
    els.generatedQuery.textContent = (e as Error).message;
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
function setBusy(state: boolean): void {
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
      const res = await bridge.preview({
        instanceUrl: instanceUrl2,
        groups,
        filters: sets[i]
      });
      if (!res.ok) throw new Error(res.error);
      lastQuery = res.encodedQuery || lastQuery;
      const label = sets.length > 1 ? `Preview set ${i + 1}/${sets.length}` : "Preview";
      logger.log(`${label}: ${res.total} tickets match`);
      if (res.limit && res.limit > 0 && res.total! > res.limit) {
        overLimit++;
        logger.log(`${label}: ${res.total} tickets EXCEEDS the max-tickets limit (${res.limit}) \u2014 this set will be SKIPPED on run. Narrow it or raise the limit in Settings`, "error");
      } else {
        pullable += res.total!;
      }
    }
    progressCard.setLabel(overLimit ? `${pullable} pullable \xB7 ${overLimit} set(s) skipped by limit` : `${pullable} matching ticket${pullable === 1 ? "" : "s"}`);
    showToast(`Preview \u2014 ${pullable} matching ticket${pullable === 1 ? "" : "s"}`);
    if (lastQuery) logger.log(`Query: ${lastQuery}`);
  } catch (err) {
    progressCard.setLabel((err as Error).message);
    logger.log((err as Error).message, "error");
    showToast((err as Error).message, "error");
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
    await bridge.run({
      instanceUrl: requireInstance(),
      groups: configuredGroups(),
      filters: sets[0],
      filterSets: sets
    });
    logger.log(`Run started with ${sets.length} filter set${sets.length > 1 ? "s" : ""}\u2026`);
  } catch (err) {
    setBusy(false);
    progressCard.setLabel((err as Error).message);
    logger.log((err as Error).message, "error");
    showToast((err as Error).message, "error");
  }
});
$("viewBtn").addEventListener("click", () => {
  els.viewBtn.classList.remove("attention");
  openViewer();
});
let viewerTabId: number | null = null;
chrome.tabs.onRemoved.addListener((tabId: number) => {
  if (tabId === viewerTabId) viewerTabId = null;
});
async function openViewer(): Promise<void> {
  const url = chrome.runtime.getURL("viewer/viewer.html");
  if (viewerTabId !== null) {
    try {
      const tab2 = await chrome.tabs.get(viewerTabId);
      await chrome.tabs.update(tab2.id, { active: true });
      await chrome.windows.update(tab2.windowId, { focused: true });
      bridge.notifyDataUpdated();
      return;
    } catch {
      viewerTabId = null;
    }
  }
  const tab = await chrome.tabs.create({ url });
  viewerTabId = tab.id;
}
bridge.onProgress((msg: MsgProgress) => {
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
    chrome.storage.local.get(["lastRun"], (cfg: { lastRun?: unknown }) => {
      if (cfg.lastRun) {
        const lastRun = cfg.lastRun as { tickets?: unknown; group?: unknown; at?: string };
        els.lastRun.textContent = `Last run: ${lastRun.tickets} tickets for "${lastRun.group}" \xB7 ${String(lastRun.at).slice(0, 16).replace("T", " ")}`;
      }
    });
    return;
  }
  logger.log(detail);
});
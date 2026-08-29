import { buildEncodedQuery } from "../lib/querybuilder.js";
import { snStateChoices, SN_PRIORITY_CHOICES, SN_TABLE_LABELS } from "../lib/statechoices.js";
import { STORAGE, MSG } from "../lib/keys.js";
import { createLogger } from "./log.js";
import { broadcast } from "../lib/storage.js";
import { showToast } from "../lib/toast.js";
import { initTooltips, setTip } from "../lib/tooltip.js";

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
  filterListCard: $("filterListCard"),
  filterListBox: $("filterListBox"),
  addFilterBtn: $("addFilterBtn"),
  condRows: $("condRows"),
  addCondBtn: $("addCondBtn"),
  preview: $("previewBtn"),
  runBtn: $("runBtn"),
  progressWrap: $("progressWrap"),
  fill: $("fill"),
  stageLabel: $("stageLabel"),
  pullCounter: $("pullCounter"),
  viewBtn: $("viewBtn"),
  logCard: $("logCard"),
  log: $("log"),
  lastRun: $("lastRun"),
  logHead: $("logHead"),
  logErrBadge: $("logErrBadge"),
  logModal: $("logModal"),
  logMirror: $("logMirror"),
  logClose: $("logClose"),
  logCopy: $("logCopy")
};
const logger = createLogger(els);
let busy = false;
function choiceList(key) {
  if (key === "states") return snStateChoices(els.ticketType.value);
  if (key === "incidentStates") return snStateChoices("incident");
  if (key === "priorities") return SN_PRIORITY_CHOICES;
  return [];
}
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
  renderCondRows();
  refreshGenerated();
}
$("settingsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
initTooltips();
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
  if (area === "local" && ch.pluginSettings) applyPluginSettings();
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
let filterList = [];
try {
  filterList = JSON.parse(localStorage.getItem(STORAGE.snFilterList) || "[]");
} catch {
}
const COND_OP_LABELS = {
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  eq: "is",
  neq: "is not",
  contains: "contains",
  notContains: "doesn't contain",
  startsWith: "starts with",
  before: "before",
  after: "after",
  between: "between"
};
function conditionText(c) {
  const def = COND_FIELDS.find((x) => x.field === c.field);
  const label = def ? def.label : c.field;
  const op = COND_OP_LABELS[c.oper] || c.oper;
  if (c.oper === "isEmpty" || c.oper === "isNotEmpty") return `${label} ${op}`;
  let val = String(c.value ?? "");
  if (def?.type === "choice") {
    const hit = choiceList(def.choicesKey).find((v) => String(v.value) === val);
    if (hit) val = hit.label;
  }
  if (c.oper === "between") return `${label} between ${val} and ${c.value2}`;
  return `${label} ${op} ${val}`;
}
function conditionsSummary(conds) {
  let out = "";
  (conds || []).forEach((c, i) => {
    out += i > 0 ? c.join === "OR" ? " OR " : " AND " : "";
    out += conditionText(c);
  });
  return out;
}
function describeFilterSet(f) {
  const bits = [SN_TABLE_LABELS[f.table] || f.table];
  const cs = conditionsSummary(f.conditions);
  if (cs) bits.push(cs);
  return bits.join(" \xB7 ");
}
function filterKey(f) {
  return JSON.stringify([f.table, f.conditions]);
}
function renderFilterList() {
  els.filterListCard.classList.toggle("hidden", !filterList.length);
  els.addFilterBtn.textContent = filterList.length ? `Add to filter list (${filterList.length})` : "+ Add to filter list";
  els.filterListBox.innerHTML = "";
  filterList.forEach((f, i) => {
    const div = document.createElement("div");
    div.className = "flitem";
    const span = document.createElement("span");
    span.textContent = describeFilterSet(f);
    const btn = document.createElement("button");
    btn.type = "button";
    setTip(btn, "Remove");
    btn.textContent = "\u2715";
    btn.addEventListener("click", () => {
      filterList.splice(i, 1);
      saveFilterList();
    });
    div.append(span, btn);
    els.filterListBox.appendChild(div);
  });
}
function saveFilterList() {
  localStorage.setItem(STORAGE.snFilterList, JSON.stringify(filterList));
  renderFilterList();
}
$("addFilterBtn").addEventListener("click", () => {
  try {
    const f = currentFilters();
    delete f.onlyMyQueue;
    delete f.rawQuery;
    const key = filterKey(f);
    if (filterList.some((x) => filterKey(x) === key)) {
      logger.log("This exact filter set is already in the list");
      return;
    }
    filterList.push(f);
    saveFilterList();
    condRows = [];
    renderCondRows();
    refreshGenerated();
    els.filterListCard.classList.remove("flash");
    void els.filterListCard.offsetWidth;
    els.filterListCard.classList.add("flash");
    setTimeout(() => els.filterListCard.classList.remove("flash"), 1e3);
    logger.log(`Added filter ${filterList.length}: ${describeFilterSet(f)}`, "success");
    showToast(`Filter ${filterList.length} added`);
  } catch (err) {
    logger.log(err.message, "error");
    showToast(err.message, "error");
  }
});
$("clearFilterListBtn").addEventListener("click", () => {
  filterList = [];
  saveFilterList();
});
renderFilterList();
function condsAllowedForTable() {
  const t = els.ticketType.value;
  return COND_FIELDS.filter((f) => !f.tables || f.tables.includes(t));
}
const COND_OPS = {
  ref: [["isEmpty", "is empty"], ["isNotEmpty", "is not empty"]],
  string: [["contains", "contains"], ["notContains", "doesn't contain"], ["startsWith", "starts with"], ["eq", "is"], ["isEmpty", "is empty"], ["isNotEmpty", "is not empty"]],
  choice: [["eq", "is"], ["neq", "is not"]],
  date: [["before", "before"], ["after", "after"], ["between", "between"]]
};
let condRows = [];
function condFieldDef(key) {
  return COND_FIELDS.find((f) => f.key === key);
}
function createJoinSelector(row) {
  const joinSel = document.createElement("select");
  joinSel.className = "cjoin";
  for (const [v, lbl] of [["AND", "AND"], ["OR", "OR"]]) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = lbl;
    joinSel.appendChild(o);
  }
  joinSel.value = row.join || "AND";
  joinSel.addEventListener("change", () => {
    row.join = joinSel.value;
    refreshGenerated();
  });
  return joinSel;
}
function createFieldSelector(row) {
  const fieldSel = document.createElement("select");
  fieldSel.className = "cfield";
  for (const f of condsAllowedForTable()) {
    const o = document.createElement("option");
    o.value = f.key;
    o.textContent = f.label;
    fieldSel.appendChild(o);
  }
  if (![...fieldSel.options].some((o) => o.value === row.field)) {
    row.field = fieldSel.options[0]?.value || "";
    row.op = (COND_OPS[condFieldDef(row.field)?.type] || [])[0]?.[0];
    row.value = "";
    row.value2 = "";
  }
  fieldSel.value = row.field;
  fieldSel.addEventListener("change", () => {
    row.field = fieldSel.value;
    row.op = (COND_OPS[condFieldDef(row.field).type][0] || [])[0];
    row.value = "";
    row.value2 = "";
    renderCondRows();
    refreshGenerated();
  });
  return fieldSel;
}
function createValueWidget(def, row) {
  if (def.type === "choice") {
    const valSel = document.createElement("select");
    valSel.className = "cval";
    const list = choiceList(def.choicesKey);
    for (const c of list) {
      const o = document.createElement("option");
      o.value = String(c.value);
      o.textContent = c.label;
      valSel.appendChild(o);
    }
    if (!list.length) {
      const o = document.createElement("option");
      o.textContent = "(no values)";
      valSel.appendChild(o);
    }
    if (row.value) valSel.value = String(row.value);
    else if (list.length) {
      row.value = String(list[0].value);
      valSel.value = row.value;
    }
    valSel.addEventListener("change", () => {
      row.value = valSel.value;
      refreshGenerated();
    });
    return valSel;
  }
  const inp = document.createElement("input");
  inp.className = "cval";
  inp.type = def.type === "date" ? "date" : "text";
  inp.placeholder = def.type === "date" ? "" : "value";
  inp.value = row.value || "";
  inp.addEventListener("input", () => {
    row.value = inp.value;
    refreshGenerated();
  });
  if (def.type === "date" && row.op === "between") {
    const inp2 = document.createElement("input");
    inp2.className = "cval";
    inp2.type = "date";
    inp2.value = row.value2 || "";
    inp2.addEventListener("input", () => {
      row.value2 = inp2.value;
      refreshGenerated();
    });
    const wrap = document.createElement("span");
    wrap.append(inp, inp2);
    return wrap;
  }
  return inp;
}
function createDeleteButton(index) {
  const del = document.createElement("button");
  del.type = "button";
  del.className = "cdel";
  setTip(del, "Remove condition");
  del.textContent = "\u2715";
  del.addEventListener("click", () => {
    condRows.splice(index, 1);
    condRows.forEach((c, j) => {
      if (j > 0 && !c.join) c.join = "AND";
    });
    renderCondRows();
    refreshGenerated();
  });
  return del;
}
function renderCondRows() {
  els.condRows.innerHTML = "";
  if (!condRows.length) {
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "No conditions \u2014 e.g. Assigned-to is empty OR State is In Progress";
    els.condRows.appendChild(hint);
    return;
  }
  condRows.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "crow";
    if (i > 0) row.appendChild(createJoinSelector(r));
    row.appendChild(createFieldSelector(r));
    const def = condFieldDef(r.field);
    const opSel = document.createElement("select");
    opSel.className = "cop";
    for (const [v, lbl] of COND_OPS[def.type] || []) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = lbl;
      opSel.appendChild(o);
    }
    opSel.value = r.op;
    opSel.addEventListener("change", () => {
      r.op = opSel.value;
      renderCondRows();
      refreshGenerated();
    });
    row.appendChild(opSel);
    if (!["isEmpty", "isNotEmpty"].includes(r.op)) {
      row.appendChild(createValueWidget(def, r));
    }
    row.appendChild(createDeleteButton(i));
    els.condRows.appendChild(row);
  });
}
els.addCondBtn.addEventListener("click", () => {
  condRows.push({ field: COND_FIELDS[0].key, op: COND_OPS.ref[0][0], value: "", value2: "", join: "AND" });
  renderCondRows();
});
renderCondRows();
function collectConditions() {
  const allowed = condsAllowedForTable();
  return condRows.map((r, i) => {
    const def = condFieldDef(r.field);
    if (!def) throw new Error(`Condition ${i + 1}: unknown column`);
    if (!allowed.includes(def)) {
      throw new Error(`Condition ${i + 1}: ${def.label} does not exist on ${SN_TABLE_LABELS[els.ticketType.value] || els.ticketType.value}`);
    }
    const known = (COND_OPS[def.type] || []).some(([v]) => v === r.op);
    if (!known) throw new Error(`Condition ${i + 1}: pick an operator`);
    if (!["isEmpty", "isNotEmpty"].includes(r.op)) {
      if (!String(r.value || "").trim()) throw new Error(`Condition ${i + 1}: enter a value`);
      if (r.op === "between" && !String(r.value2 || "").trim()) throw new Error(`Condition ${i + 1}: enter the second date`);
    }
    return { join: i === 0 ? "AND" : r.join || "AND", field: def.field, oper: r.op, value: r.value || "", value2: r.value2 || "" };
  });
}
function requireInstance() {
  const url = instanceUrl();
  if (!/^https:\/\/.+/.test(url)) throw new Error("Enter a valid https instance URL");
  return url;
}
function currentFilters() {
  return {
    table: els.ticketType.value,
    conditions: collectConditions(),
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
    els.generatedQuery.textContent = q || `(no filters \u2014 all ${SN_TABLE_LABELS[els.ticketType.value] || "tickets"} you can read)`;
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
  renderCondRows();
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
  els.progressWrap.classList.toggle("hidden", !state);
  if (state) {
    els.fill.style.width = "4%";
    els.fill.style.background = "#fab387";
    els.stageLabel.textContent = "Starting\u2026";
  }
}
els.preview.addEventListener("click", async () => {
  try {
    setBusy(true);
    els.stageLabel.textContent = "Counting\u2026";
    const instanceUrl2 = requireInstance();
    const groups = configuredGroups();
    const live = currentFilters();
    const sets = filterList.length ? filterList.map((f) => ({ ...f, rawQuery: live.rawQuery })) : [live];
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
    els.stageLabel.textContent = overLimit ? `${pullable} pullable \xB7 ${overLimit} set(s) skipped by limit` : `${pullable} matching ticket${pullable === 1 ? "" : "s"}`;
    showToast(`Preview \u2014 ${pullable} matching ticket${pullable === 1 ? "" : "s"}`);
    if (lastQuery) logger.log(`Query: ${lastQuery}`);
  } catch (err) {
    els.stageLabel.textContent = err.message;
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
    const sets = filterList.length ? filterList.map((f) => ({ ...f, rawQuery: live.rawQuery })) : [live];
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
    els.stageLabel.textContent = err.message;
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
const STAGE_PCT = { resolve: 8, count: 15, phase1: null, phase2: null, analyze: 92 };
const STAGE_BASE = { phase1: 20, phase2: 60 };
const fmtNum = (n) => Number(n || 0).toLocaleString("en-US");
function updatePullCounter(pulled, planned) {
  if (typeof pulled !== "number" || typeof planned !== "number" || planned <= 0) {
    els.pullCounter.classList.add("hidden");
    return false;
  }
  els.pullCounter.textContent = `${fmtNum(pulled)} of ${fmtNum(planned)} pulled \xB7 ${fmtNum(Math.max(0, planned - pulled))} remaining`;
  els.pullCounter.classList.remove("hidden");
  return true;
}
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== MSG.progress) return;
  const { stage, detail } = msg;
  if (stage === "diag") {
    const isProblem = /401|403|429|MISSING|RATE LIMITED/.test(detail);
    logger.log(detail, isProblem ? "error" : "");
    return;
  }
  if (stage === "limit") {
    els.fill.style.width = "100%";
    els.fill.style.background = "var(--bad)";
    els.stageLabel.textContent = detail;
    logger.log(detail, "error");
    showToast(detail, "error");
    setBusy(false);
    return;
  }
  if (stage === "error") {
    els.fill.style.width = "100%";
    els.fill.style.background = "var(--bad)";
    els.stageLabel.textContent = detail;
    logger.log(detail, "error");
    showToast(detail, "error");
    setBusy(false);
    return;
  }
  els.stageLabel.textContent = detail;
  if (stage !== "done") logger.log(detail);
  const hasCounts = updatePullCounter(msg.pulled, msg.planned);
  let pct = STAGE_PCT[stage];
  if (hasCounts && stage === "phase1") {
    els.fill.style.width = STAGE_BASE.phase1 + Math.min(1, msg.pulled / msg.planned) * 40 + "%";
  } else if (pct === null) {
    const m = detail.match(/(\d+)\/(\d+)/);
    pct = m ? STAGE_BASE[stage] + +m[1] / +m[2] * (stage === "phase1" ? 40 : 25) : STAGE_BASE[stage];
    els.fill.style.width = Math.min(pct, STAGE_BASE[stage] + 24) + "%";
  } else if (typeof pct === "number") {
    els.fill.style.width = pct + "%";
  }
  if (stage === "done") {
    els.pullCounter.classList.add("hidden");
    els.fill.style.width = "100%";
    els.fill.style.background = "var(--good)";
    els.stageLabel.textContent = detail;
    logger.log(detail, "success");
    showToast(`Run complete \u2014 ${msg.pulled ?? 0} ticket${msg.pulled === 1 ? "" : "s"} pulled`);
    setBusy(false);
    els.viewBtn.classList.add("attention");
    chrome.storage.local.get(["lastRun"], (cfg) => {
      if (cfg.lastRun) {
        els.lastRun.textContent = `Last run: ${cfg.lastRun.tickets} tickets for "${cfg.lastRun.group}" \xB7 ${cfg.lastRun.at.slice(0, 16).replace("T", " ")}`;
      }
    });
  }
});


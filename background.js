import { buildEncodedQuery } from "./lib/querybuilder.js";
import { snStateMap, SN_TABLE_LABELS } from "./lib/statechoices.js";
import { STORAGE, MSG } from "./lib/keys.ts";
import { broadcast } from "./lib/storage.js";
import { normalizeNames } from "./lib/names.js";
import * as Analysis from "./analysis/phase2.js";
import { analyzeAll } from "./analysis/phase2.js";
import { mergeRows } from "./lib/rowmerge.js";
import { createSmartTransport } from "./data/datasource/sn-transport.ts";
import { createServiceNowRemote } from "./data/datasource/sn-remote.ts";
import { SETTINGS_REPO, SN_REMOTE, TICKET_REPO, TIMELINE_REPO } from "./di/tokens.ts";
import { createBackgroundContainer } from "./di/register-background.ts";

globalThis.Analysis = Analysis;

const rootContainer = createBackgroundContainer();

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
});
const DEFAULT_FIELDS = [
  "sys_id",
  "number",
  "state",
  "priority",
  "assignment_group",
  "assigned_to",
  "opened_at",
  "closed_at",
  "short_description",
  "caller_id",
  "category",
  "sys_updated_on",
  "sys_updated_by",
  "cmdb_ci",
  "sys_created_on",
  "incident_state",
  "resolved_at",
  "close_code",
  "close_notes",
  "work_notes",
  "comments"
];
let running = false;
function diagError(type, err) {
  try {
    progress("diag", `${type} failed: ${err.message}`);
  } catch {
  }
}
function onDiagnostic(d) {
  const ms = typeof d.ms === "number" ? ` \xB7 ${d.ms}ms` : "";
  if (d.kind === "warn") {
    if (d.note) {
      progress("diag", `${d.path || "audit"} \u26A0 ${d.note}`);
      return;
    }
    if (d.rateLimited) {
      progress("diag", `\u26A0 RATE LIMITED \u2014 ServiceNow is throttling requests; auto-retrying (${d.attempt}/${4}). If this repeats, reduce tickets per run or ask your admin about rate-limit rules.`);
      return;
    }
    const why = d.netError ? `network: ${d.netError}` : `server ${d.status}`;
    progress("diag", `${d.path} \u2715 ${why} \xB7 retrying (${d.attempt}/${4})${ms} \xB7 q=${d.query || ""}`);
    return;
  }
  if (d.kind === "err") {
    progress("diag", `${d.path} \u2192 HTTP ${d.status}${ms}${d.retriesExhausted ? " \xB7 retries exhausted" : ""} \xB7 q=${d.query || ""}`);
    return;
  }
  const token = d.hadToken === null || d.hadToken === void 0 ? "" : ` \xB7 token=${d.hadToken ? d.tokenSource || "sent" : "MISSING"}`;
  const rows = d.bodyRows !== void 0 && d.bodyRows !== null ? ` \xB7 result=${d.bodyRows}` : "";
  const preview = d.bodyPreview ? ` \xB7 body=${d.bodyPreview}` : "";
  progress("diag", `${d.path} \u2192 ${d.status}${ms} \xB7 via=${d.via}${token}${rows} \xB7 q=${d.query || ""}${preview}`);
}

/**
 * Builds a per-run container: one ServiceNow remote bound to `instanceUrl`,
 * plus the cache-backed repositories that read through it.
 *
 * The remote is registered on a child rather than the root because it is
 * request-specific; the repositories cache the resolved instance per
 * container, so a child also keeps one run from reusing another's wiring.
 */
async function makeRunContainer(instanceUrl) {
  const settings = await rootContainer.resolve(SETTINGS_REPO).load();
  const params = settings?.params || {};

  const child = rootContainer.child();
  child.registerValue(
    SN_REMOTE,
    createServiceNowRemote(instanceUrl, createSmartTransport(), {
      pageSize: clampNum(params.tablePageSize, 100, 5e3) || undefined,
      debugResponses: !!params.debugResponses,
      onDiagnostic
    })
  );

  child.resolve(TICKET_REPO).setQueryTtlMinutes(params.cacheTtlMinutes);
  return child;
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === MSG.ping) {
    sendResponse({ ok: true, running });
    return false;
  }
  if (msg.type === MSG.count) {
    handleCount(msg).then(sendResponse).catch((err) => {
      diagError(MSG.count, err);
      sendResponse({ ok: false, error: err.message });
    });
    return true;
  }
  if (msg.type === MSG.run) {
    runPull(msg);
    sendResponse({ ok: true, started: true });
    return true;
  }
  return false;
});
function clampNum(v, lo, hi) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
}
function scopeGroups(msg) {
  const groups = (Array.isArray(msg.groups) ? msg.groups : []).map((g) => typeof g === "string" ? g : g?.name).map((n) => String(n || "").trim()).filter(Boolean);
  const unique = [...new Set(groups)];
  if (!unique.length) {
    throw new Error("No queues configured \u2014 open Settings and add assignment group names, one per line");
  }
  const badComma = unique.find((g) => g.includes(","));
  if (badComma) {
    throw new Error(`Queue name "${badComma}" contains a comma \u2014 commas cannot be used in queue scope (assignment_group.nameIN list). Rename the queue in Settings`);
  }
  return unique;
}
function groupScopeOf(groupNames) {
  return { groupNames };
}
/** @param {import("./types/global.d.ts").MsgCount} msg */
async function handleCount(msg) {
  const table = String(msg.filters?.table || "incident");
  const container = await makeRunContainer(msg.instanceUrl);
  const groups = scopeGroups(msg);
  const { memberSysIds: _drop, ...filters } = msg.filters || {};
  const encodedQuery = buildEncodedQuery({ ...filters, ...groupScopeOf(groups) });
  const total = await container.resolve(TICKET_REPO).count(table, encodedQuery);
  const settings = await rootContainer.resolve(SETTINGS_REPO).load();
  const limit = clampNum(settings?.params?.maxTicketsPerPull, 0, 1e5) ?? 0;
  return { ok: true, total, encodedQuery, limit };
}
function progress(stage, detail, extra = {}) {
  broadcast({ type: MSG.progress, stage, detail, ...extra });
}

async function processFilterSet(tickets, set, index, totalSets, groupScope, fields, maxTickets, abortSignal) {
  const table = set.table || "incident";
  const label = `Filter ${index + 1}/${totalSets}`;
  const { memberSysIds: _drop, ...rest } = set;
  const encodedQuery = buildEncodedQuery({ ...rest, ...groupScope });
  progress("count", `${label}: counting...`);
  const total = await tickets.count(table, encodedQuery);
  progress("count", `${label}: ${total} tickets matched`);
  if (maxTickets > 0 && total > maxTickets) {
    progress("limit", `${label}: LIMIT \u2014 ${total} tickets match but the maximum is ${maxTickets} (Settings). Set skipped \u2014 narrow the filter or raise the limit`);
    return { table, query: encodedQuery, pulled: 0, skippedLimit: true, matched: total, planned: 0, pulledDelta: 0, records: null };
  }
  if (total === 0) {
    return { table, query: encodedQuery, pulled: 0, planned: 0, pulledDelta: 0, records: null };
  }
  progress("phase1", `${label}: pulling ${total} tickets...`);
  const { records, source, cachedAt } = await tickets.list({
    table,
    encodedQuery,
    fields,
    signal: abortSignal,
    onProgress: (p) => progress("phase1", `${label}: phase1 ${p.fetched}/${total} tickets`)
  });
  if (source === "cache") {
    const ageMin = Math.max(1, Math.round((Date.now() - (cachedAt || Date.now())) / 6e4));
    progress("phase1", `${label}: CACHE HIT \u2014 reused ${records.length} tickets from ${ageMin} min ago (no API calls)`);
  }
  return {
    table,
    query: encodedQuery,
    pulled: records.length,
    cached: source === "cache",
    cacheAt: cachedAt || null,
    planned: total,
    pulledDelta: records.length,
    records
  };
}

async function fetchTimelines(timelines, records, table, abortSignal, membersByQueue, teamNames) {
  const tLabel = SN_TABLE_LABELS[table] || table;
  const sysIds = records.map((r) => r.sys_id?.value || r.sys_id).filter(Boolean);
  progress("phase2", `Phase 2 (${tLabel}): activity feed for ${sysIds.length} tickets...`);

  const tickets = records
    .map((r) => ({
      sysId: String(r.sys_id?.value || r.sys_id || ""),
      updatedOn: String(r.sys_updated_on?.value || r.sys_updated_on || "")
    }))
    .filter((t) => t.sysId);

  const { events: cachedEvents, reused } = await timelines.getMany({
    table,
    tickets,
    signal: abortSignal,
    onProgress: (p) => progress("phase2", `Phase 2 (${tLabel}): activity ticket ${p.ticketsDone}/${p.total}`)
  });

  const eventsByTicket = {};
  for (const [sysId, events] of cachedEvents) eventsByTicket[sysId] = events;

  if (reused) {
    progress("phase2", `Phase 2 (${tLabel}): ${reused}/${sysIds.length} timelines reused from cache`);
  }

  const auditCount = Object.keys(eventsByTicket).length;
  const sampleAuditRows = Object.entries(eventsByTicket).slice(0, 3).map(([k, v]) => ({ sysId: k.slice(0, 8), rows: v.length }));
  progress("analyze", `Applying timeline rules (${tLabel})...`);
  const { rows, missingAudit } = analyzeAll(records, eventsByTicket, snStateMap(table), { membersByQueue, fallbackMembers: teamNames, tableName: table });
  return { rows, missingAudit, auditCount, sampleAuditRows, sampleRecord: records[0] || null };
}

async function persistResults(rows, runEntries, missingAudit, auditCounts, sampleAuditRows, sampleRecord, msg, groups, plannedSum) {
  const prev = (await chrome.storage.local.get([STORAGE.lastData])).lastData;
  const merged = mergeRows(prev?.rows || [], rows);
  const at = (/* @__PURE__ */ new Date()).toISOString();
  const group = groups.join(", ");
  const runs = [...prev?.runs || [], ...runEntries.map((e) => ({
    at,
    table: e.table,
    group,
    query: e.query,
    pulled: e.pulled
  }))];
  await chrome.storage.local.set({
    lastData: {
      at: (/* @__PURE__ */ new Date()).toISOString(),
      instance: msg.instanceUrl,
      missingAudit: (prev?.missingAudit || 0) + missingAudit,
      totalPulled: merged.length,
      debug: {
        sampleRecord,
        ticketsWithAudit: Object.values(auditCounts).reduce((a, b) => a + b, 0),
        auditCountsByTable: auditCounts,
        sampleAuditRowCounts: sampleAuditRows,
        sampleTimelines: rows.filter((r) => r.assignTimeUtcIso || r.acknTimeUtcIso || r.suspendTimeUtcIso || r.resumeTimeUtcIso).slice(0, 3).map((r) => ({ number: r.number, assign: r.assignTimeUtcIso, ackn: r.acknTimeUtcIso, suspend: r.suspendTimeUtcIso, resume: r.resumeTimeUtcIso }))
      },
      runs,
      rows: merged
    }
  });
  await chrome.storage.local.set({
    lastRun: {
      at: (/* @__PURE__ */ new Date()).toISOString(),
      instance: msg.instanceUrl,
      query: runEntries.map((e) => `[${SN_TABLE_LABELS[e.table] || e.table}] ${e.query}`).join(" | "),
      group: groups.join(", "),
      tickets: rows.length
    }
  });
  broadcast({ type: MSG.dataUpdated });
  const skippedSets = runEntries.filter((e) => e.skippedLimit);
  progress(
    "done",
    `Run complete: ${rows.length} pulled \xB7 ${merged.length} total in view` + (missingAudit ? ` \xB7 ${missingAudit} had no audit data` : "") + (skippedSets.length ? ` \xB7 ${skippedSets.length} filter set(s) SKIPPED by max-tickets limit (${skippedSets.map((e) => e.matched).join(", ")} matched) \u2014 raise the limit in Settings to include them` : ""),
    { pulled: rows.length, planned: plannedSum }
  );
}

async function resolveRunSettings(msg) {
  const settings = (await chrome.storage.local.get([STORAGE.pluginSettings])).pluginSettings;
  const groups = scopeGroups(msg);
  progress("resolve", `Queues (from settings): ${groups.join(", ")}`);
  const groupScope = groupScopeOf(groups);
  const teamNames = normalizeNames(settings?.defaults?.teamMembers || []);
  if (!teamNames.length) {
    progress("resolve", "No team members configured \u2014 acknowledgement dates will stay empty");
  } else {
    progress("resolve", `${teamNames.length} team member(s) configured for acknowledgement detection`);
  }
  const membersByQueue = Object.fromEntries(groups.map((g) => [g, teamNames]));
  const maxTickets = clampNum(settings?.params?.maxTicketsPerPull, 0, 1e5) ?? 0;
  if (maxTickets > 0) progress("resolve", `Max tickets per filter set: ${maxTickets}`);
  return { groups, groupScope, teamNames, membersByQueue, maxTickets };
}

async function pullFilterSets(tickets, sets, groupScope, fields, maxTickets, signal) {
  const byTable = /* @__PURE__ */ new Map();
  const runEntries = [];
  let plannedSum = 0;
  let pulledDone = 0;
  for (let i = 0; i < sets.length; i++) {
    const result = await processFilterSet(tickets, sets[i], i, sets.length, groupScope, fields, maxTickets, signal);
    plannedSum += result.planned;
    if (!result.records) {
      runEntries.push({ table: result.table, query: result.query, pulled: result.pulled, skippedLimit: result.skippedLimit || false, matched: result.matched });
      continue;
    }
    pulledDone += result.pulledDelta;
    progress("phase1", `Filter ${i + 1}/${sets.length}: ${result.records.length} tickets`, { pulled: pulledDone, planned: plannedSum });
    if (!byTable.has(result.table)) byTable.set(result.table, /* @__PURE__ */ new Map());
    const bucket = byTable.get(result.table);
    let fresh = 0;
    for (const r of result.records) {
      const id = r.sys_id?.value || r.sys_id;
      if (id && !bucket.has(id)) {
        bucket.set(id, r);
        fresh++;
      }
    }
    runEntries.push({ table: result.table, query: result.query, pulled: result.pulled, new: fresh, cached: !!result.cached, cacheAt: result.cacheAt || null });
  }
  return { byTable, runEntries, plannedSum };
}

async function fetchAllTimelines(timelines, byTable, signal, membersByQueue, teamNames) {
  const allRows = [];
  let missingAuditTotal = 0;
  const auditCounts = {};
  const sampleAuditRows = [];
  let sampleRecord = null;
  for (const [table, bucket] of byTable) {
    const records = [...bucket.values()];
    if (!records.length) continue;
    const tl = await fetchTimelines(timelines, records, table, signal, membersByQueue, teamNames);
    auditCounts[table] = tl.auditCount;
    if (!sampleRecord) sampleRecord = tl.sampleRecord;
    if (!sampleAuditRows.length) sampleAuditRows.push(...tl.sampleAuditRows);
    allRows.push(...tl.rows);
    missingAuditTotal += tl.missingAudit;
  }
  return { rows: allRows, missingAudit: missingAuditTotal, auditCounts, sampleAuditRows, sampleRecord };
}

/** @param {import("./types/global.d.ts").MsgRun} msg */
async function runPull(msg) {
  if (running) return;
  running = true;
  const abort = new AbortController();
  try {
    const container = await makeRunContainer(msg.instanceUrl);
    const tickets = container.resolve(TICKET_REPO);
    const timelines = container.resolve(TIMELINE_REPO);
    const { groups, groupScope, membersByQueue, teamNames, maxTickets } = await resolveRunSettings(msg);
    const sets = Array.isArray(msg.filterSets) && msg.filterSets.length ? msg.filterSets : [msg.filters || {}];
    const { byTable, runEntries, plannedSum } = await pullFilterSets(tickets, sets, groupScope, msg.fields || DEFAULT_FIELDS, maxTickets, abort.signal);
    const { rows, missingAudit, auditCounts, sampleAuditRows, sampleRecord } = await fetchAllTimelines(timelines, byTable, abort.signal, membersByQueue, teamNames);
    if (!rows.length) throw new Error("No tickets match this filter list");
    await persistResults(rows, runEntries, missingAudit, auditCounts, sampleAuditRows, sampleRecord, msg, groups, plannedSum);
  } catch (err) {
    progress("error", err.message);
  } finally {
    running = false;
  }
}

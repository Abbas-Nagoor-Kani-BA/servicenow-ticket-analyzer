/**
 * Per-ticket timeline extraction context. `queueName` and `snapshotGroupName`
 * are compared in name-space (lowercased/trimmed) via {@link nameKey}.
 * @typedef {Object} ExtractCtx
 * @property {Record<string,string>} stateMap OOB state value->label map
 * @property {string} queueName name-keyed target queue
 * @property {string[]} memberNames plain team-member names for ackn detection
 * @property {string} snapshotGroupName the ticket's current group display name
 * @property {string} openedAt raw opened_at ISO string
 */

function parseUtc(s) {
  if (!s) return NaN;
  const str = String(s).trim().replace(" ", "T");
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(str) ? str : str + "Z");
}

function nameKey(v) {
  return String(v ?? "").trim().toLowerCase();
}

function toIso(epoch) {
  return new Date(epoch).toISOString();
}

function resolveLabel(stateMap, v) {
  const raw = String(v ?? "").trim();
  return stateMap[raw] || raw;
}

function normalizeEvents(auditRows) {
  return (auditRows || [])
    .map(r => ({
      field: r.field,
      oldValue: r.oldValue || "",
      newValue: r.newValue || "",
      at: parseUtc(r.at)
    }))
    .filter(e => Number.isFinite(e.at))
    .sort((a, b) => a.at - b.at);
}

function createResult() {
  return {
    assignTime: null,
    acknTime: null,
    suspendTime: null,
    resumeTime: null,
    resumeSource: null,
    onHoldCount: 0,
    lastQueueEntryAt: null
  };
}

function applyBornInQueueFallback(events, result, ctx) {
  const inQueue = g => g != null && nameKey(g) === nameKey(ctx.queueName);
  const hasGroupEvent = events.some(e => e.field === "assignment_group");
  if (hasGroupEvent || !inQueue(ctx.snapshotGroupName)) return null;
  const bornAt = parseUtc(ctx.openedAt);
  if (!Number.isFinite(bornAt)) return null;
  result.assignTime = toIso(bornAt);
  result.lastQueueEntryAt = bornAt;
  return ctx.snapshotGroupName;
}

function handleGroupEvent(e, result, ctx, loopState) {
  const inQueue = g => g != null && nameKey(g) === nameKey(ctx.queueName);
  if (inQueue(e.newValue)) {
    result.assignTime = toIso(e.at);
    result.lastQueueEntryAt = e.at;
  }
  loopState.currentGroup = e.newValue;
}

function handleAssignmentEvent(e, result, ctx, loopState) {
  if (loopState.memberSet.has(nameKey(e.newValue))) {
    loopState.memberAssignments.push(e.at);
  }
}

function handleStateEvent(e, result, ctx, loopState) {
  const inQueue = g => g != null && nameKey(g) === nameKey(ctx.queueName);
  if (!inQueue(loopState.currentGroup)) return;

  const toLabel = resolveLabel(ctx.stateMap, e.newValue).toLowerCase();
  const fromLabel = resolveLabel(ctx.stateMap, e.oldValue).toLowerCase();

  if (toLabel === "on hold" && fromLabel !== "on hold") {
    result.onHoldCount++;
    if (!result.suspendTime) {
      result.suspendTime = toIso(e.at);
      loopState.suspendEpoch = e.at;
    }
  }

  if (loopState.suspendEpoch && e.at >= loopState.suspendEpoch) {
    if (toLabel === "in progress") {
      result.resumeTime = toIso(e.at);
      result.resumeSource = "In Progress";
    } else if (toLabel === "resolved") {
      result.resumeTime = toIso(e.at);
      result.resumeSource = "Resolved";
    }
  }
}

function resolveAcknTime(result, memberAssignments) {
  if (result.lastQueueEntryAt === null) return;
  const valid = memberAssignments.filter(at => at >= result.lastQueueEntryAt);
  if (valid.length) {
    result.acknTime = toIso(Math.min(...valid));
  }
}

function clampAssignTime(result, ctx) {
  const bornAt = parseUtc(ctx.openedAt);
  if (!Number.isFinite(bornAt)) return;
  const a = parseUtc(result.assignTime);
  if (Number.isFinite(a) && a < bornAt) {
    result.assignTime = toIso(bornAt);
  }
}

/** @param {unknown[]} auditRows @param {ExtractCtx} ctx */
function extractTimelines(auditRows, ctx) {
  const events = normalizeEvents(auditRows);
  const result = createResult();
  const memberSet = new Set((ctx.memberNames || []).map(nameKey));

  const loopState = {
    currentGroup: applyBornInQueueFallback(events, result, ctx),
    memberSet,
    memberAssignments: [],
    suspendEpoch: null
  };

  for (const e of events) {
    if (e.field === "assignment_group") handleGroupEvent(e, result, ctx, loopState);
    else if (e.field === "assigned_to") handleAssignmentEvent(e, result, ctx, loopState);
    else if (e.field === "state") handleStateEvent(e, result, ctx, loopState);
  }

  resolveAcknTime(result, loopState.memberAssignments);
  clampAssignTime(result, ctx);
  return result;
}

function fieldValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return v.display_value || v.value || "";
}

function rawValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return v.value || "";
}

/**
 * @param {any[]} records pulled ticket records
 * @param {object} auditByTicket sys_id -> audit rows
 * @param {Record<string,string>} stateMap value->label map
 * @param {{membersByQueue?: Record<string,string[]>, fallbackMembers?: string[], tableName?: string}} queueCtx
 */
function analyzeAll(records, auditByTicket, stateMap, queueCtx) {
  const membersByQueue = (queueCtx && queueCtx.membersByQueue) || {};
  const fallbackMembers = (queueCtx && queueCtx.fallbackMembers) || [];
  const tableName = (queueCtx && queueCtx.tableName) || "";
  const isIncident = tableName === "incident";
  const out = [];
  let missingAudit = 0;
  for (const rec of records) {
    const snapshotGroupName = fieldValue(rec.assignment_group);
    const sysId = typeof rec.sys_id === "object"
      ? (rec.sys_id.value || rec.sys_id.display_value)
      : rec.sys_id;
    const rows = auditByTicket[sysId];
    if (!rows) missingAudit++;
    const t = extractTimelines(rows, {
      stateMap,
      queueName: nameKey(snapshotGroupName),
      memberNames: membersByQueue[nameKey(snapshotGroupName)] || fallbackMembers,
      snapshotGroupName,
      openedAt: rawValue(rec.opened_at)
    });
    if (!isIncident) {
      t.suspendTime = null;
      t.resumeTime = null;
      t.resumeSource = null;
    } else {
      const stateLabel = fieldValue(rec.state).toLowerCase();
      if (!stateLabel.startsWith("close") && !stateLabel.startsWith("resolv")) {
        t.suspendTime = null;
        t.resumeTime = null;
        t.resumeSource = null;
      }
    }
    const activity = (rows || [])
      .map(r => {
        const ms = parseUtc(r.at);
        return {
          f: r.field,
          o: String(r.oldValue ?? ""),
          n: String(r.newValue ?? ""),
          at: Number.isFinite(ms) ? ms : null
        };
      })
      .filter(e => e.at !== null)
      .sort((a, b) => b.at - a.at)
      .slice(0, 500);
    out.push({
      sysId,
      number: fieldValue(rec.number),
      shortDescription: fieldValue(rec.short_description),
      state: fieldValue(rec.state),
      stateValue: rawValue(rec.state),
      priority: fieldValue(rec.priority),
      priorityValue: rawValue(rec.priority),
      category: fieldValue(rec.category),
      caller: fieldValue(rec.caller_id),
      assignmentGroup: fieldValue(rec.assignment_group),
      assignedTo: fieldValue(rec.assigned_to),
      assignedToSysId: rawValue(rec.assigned_to),
      updatedOn: fieldValue(rec.sys_updated_on),
      updatedBy: fieldValue(rec.sys_updated_by),
      configItem: fieldValue(rec.cmdb_ci),
      createdOn: fieldValue(rec.sys_created_on),
      incidentState: fieldValue(rec.incident_state),
      resolvedAt: fieldValue(rec.resolved_at),
      resolvedAtRaw: rawValue(rec.resolved_at),
      openedAt: fieldValue(rec.opened_at),
      openedAtRaw: rawValue(rec.opened_at),
      closedAt: fieldValue(rec.closed_at),
      closedAtRaw: rawValue(rec.closed_at),
      closeCode: fieldValue(rec.close_code),
      closeNotes: fieldValue(rec.close_notes),
      workNotes: fieldValue(rec.work_notes),
      comments: fieldValue(rec.comments),
      assignTime: t.assignTime || "",
      acknTime: t.acknTime || "",
      suspendTime: t.suspendTime || "",
      resumeTime: t.resumeTime || "",
      resumeSource: t.resumeSource || "",
      onHoldCount: t.onHoldCount,
      activity
    });
  }
  return { rows: out, missingAudit };
}

const ACTIVITY_ANCHORS = [
  { field: "assignment_group", labels: ["assignment group"] },
  { field: "assigned_to", labels: ["assigned to"] },
  { field: "state", labels: ["state", "incident state"] }
];

function pmHour(h, ap) {
  if (/p/i.test(ap || "") && h < 12) return h + 12;
  if (/a/i.test(ap || "") && h === 12) return 0;
  return h;
}

function parseSnDisplayMs(s) {
  const str = String(s || "").trim();
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
  if (!m) {
    m = str.match(/^(\d{1,2})[-.](\d{1,2})[-.](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], pmHour(+m[4], m[7]), +m[5], +(m[6] || 0));
    m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
    if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2], pmHour(+m[4], m[7]), +m[5], +(m[6] || 0));
    const p = Date.parse(str);
    return Number.isFinite(p) ? p : NaN;
  }
  return Date.UTC(+m[1], +m[2] - 1, +m[3], pmHour(+m[4], m[7]), +m[5], +(m[6] || 0));
}

const ACTIVITY_DT_RE = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{1,2}\/\d{1,2}\/\d{4})[ T](\d{1,2}:\d{2}(?::\d{2})?)\s*([AaPp][Mm])?/g;

function scanSnDateTime(text) {
  const re = new RegExp(ACTIVITY_DT_RE.source, "g");
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    const ms = parseSnDisplayMs(`${m[1]} ${m[2]}${m[3] ? " " + m[3] : ""}`);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return "";
}

function cleanCapture(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\\+/g, "")
    .replace(/^["'\s]+|["'\s,.;]+$/g, "")
    .trim();
}

/** @param {any[]} entries raw `/api/now/v1/activity/stream` entries */
function extractEventsFromActivity(entries) {
  const out = [];
  const seen = new Set();
  for (const entry of entries || []) {
    if (!entry || typeof entry !== "object") continue;

    const changes = Array.isArray(entry.changes) ? entry.changes : null;
    if (changes) {
      for (const ch of changes) {
        if (!ch || typeof ch !== "object") continue;
        const label = String(ch.label ?? ch.field_label ?? "").toLowerCase();
        const anchor = ACTIVITY_ANCHORS.find(a => a.labels.some(l => label === l));
        if (!anchor) continue;
        const at = scanSnDateTime(JSON.stringify(ch)) ||
          scanSnDateTime(JSON.stringify(entry));
        const ev = {
          field: anchor.field,
          oldValue: cleanCapture(ch.old_value ?? ch.old ?? ch.from ?? ""),
          newValue: cleanCapture(ch.new_value ?? ch.new ?? ch.to ?? ""),
          at
        };
        const key = `${ev.field}|${ev.oldValue}|${ev.newValue}|${ev.at}`;
        if (ev.at && !seen.has(key)) {
          seen.add(key);
          out.push(ev);
        }
      }
      continue;
    }

    const text = JSON.stringify(entry);
    if (!text) continue;
    const low = text.toLowerCase();
    for (const anchor of ACTIVITY_ANCHORS) {
      for (const label of anchor.labels) {
        const idx = low.indexOf(label);
        if (idx === -1) continue;
        const window = text.slice(idx, idx + 200);
        const m = window.match(new RegExp(
          label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
          "[^a-z]{0,3}changed from (.+?) to (.+?)(?=\\s+on\\s+[\\d<\"]|<|,|\\}|$)",
          "i"
        ));
        if (!m) continue;
        const at = scanSnDateTime(window);
        if (!at) break;
        const ev = {
          field: anchor.field,
          oldValue: cleanCapture(m[1]),
          newValue: cleanCapture(m[2]),
          at
        };
        const key = `${ev.field}|${ev.oldValue}|${ev.newValue}|${ev.at}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(ev);
        }
        break;
      }
    }
  }
  return out;
}

/** @param {any} payload raw `list_history.do` JSON response */
function extractEventsFromListHistory(payload) {
  const byTicket = {};
  for (const entry of payload?.entries || []) {
    if (!entry || typeof entry !== "object") continue;
    const docId = String(entry.document_id || "").trim();
    if (!docId) continue;
    const at = String(entry.sys_created_on || "").trim();
    if (!at) continue;
    for (const ch of entry.entries?.changes || []) {
      if (!ch || typeof ch !== "object") continue;
      let fname = String(ch.field_name || "").trim();
      if (!fname) continue;
      if (fname === "incident_state") fname = "state";
      (byTicket[docId] ||= []).push({
        field: fname,
        oldValue: String(ch.old_value ?? ch.sanitized_old_value ?? ""),
        newValue: String(ch.new_value ?? ch.sanitized_new_value ?? ""),
        at
      });
    }
  }
  return byTicket;
}

export { extractTimelines, analyzeAll, extractEventsFromActivity, extractEventsFromListHistory };

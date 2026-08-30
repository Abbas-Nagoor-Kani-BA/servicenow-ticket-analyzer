/**
 * Per-ticket timeline extraction context. `queueName` and `snapshotGroupName`
 * are compared in name-space (lowercased/trimmed) via {@link nameKey}.
 */
import { parseSnDisplayMs } from "../core/sntime.ts";

export type ExtractCtx = {
  /** OOB state value->label map */
  stateMap: Record<string, string>;
  /** name-keyed target queue */
  queueName: string;
  /** plain team-member names for ackn detection */
  memberNames: string[];
  /** the ticket's current group display name */
  snapshotGroupName: string | null;
  /** raw opened_at string in UTC (no suffix) */
  openedAtUtcRaw: string;
};

export type Event = {
  field: string | undefined;
  oldValue: string;
  newValue: string;
  atEpoch: number;
};

export type Timeline = {
  assignTimeUtcIso: string | null;
  acknTimeUtcIso: string | null;
  suspendTimeUtcIso: string | null;
  resumeTimeUtcIso: string | null;
  resumeSource: string | null;
  onHoldCount: number;
  lastQueueEntryEpoch: number | null;
};

function parseUtc(s: string | null | undefined): number {
  if (!s) return NaN;
  const str = String(s).trim().replace(" ", "T");
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(str) ? str : str + "Z");
}

function nameKey(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function toIso(epoch: number): string {
  return new Date(epoch).toISOString();
}

function utcRawToEpochMs(s: string): number {
  return parseUtc(s);
}

function epochMsToUtcIso(n: number): string {
  return toIso(n);
}

function resolveLabel(stateMap: Record<string, string>, v: unknown): string {
  const raw = String(v ?? "").trim();
  return stateMap[raw] || raw;
}

type AuditRowLike = {
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  at: string;
};

function normalizeEvents(auditRows: AuditRowLike[] | null | undefined): Event[] {
  return (auditRows || [])
    .map(r => ({
      field: r.field,
      oldValue: String(r.oldValue || ""),
      newValue: String(r.newValue || ""),
      atEpoch: utcRawToEpochMs(r.at)
    }))
    .filter(e => Number.isFinite(e.atEpoch))
    .sort((a, b) => a.atEpoch - b.atEpoch);
}

function createResult(): Timeline {
  return {
    assignTimeUtcIso: null,
    acknTimeUtcIso: null,
    suspendTimeUtcIso: null,
    resumeTimeUtcIso: null,
    resumeSource: null,
    onHoldCount: 0,
    lastQueueEntryEpoch: null
  };
}

function applyBornInQueueFallback(events: Event[], result: Timeline, ctx: ExtractCtx): string | null {
  const inQueue = (g: unknown) => g != null && nameKey(g) === nameKey(ctx.queueName);
  const hasGroupEvent = events.some(e => e.field === "assignment_group");
  if (hasGroupEvent || !inQueue(ctx.snapshotGroupName)) return null;
  const bornEpoch = utcRawToEpochMs(ctx.openedAtUtcRaw);
  if (!Number.isFinite(bornEpoch)) return null;
  result.assignTimeUtcIso = epochMsToUtcIso(bornEpoch);
  result.lastQueueEntryEpoch = bornEpoch;
  return ctx.snapshotGroupName;
}

type LoopState = {
  currentGroup: string | null;
  memberSet: Set<string>;
  memberAssignments: number[];
  suspendEpoch: number | null;
};

function handleGroupEvent(e: Event, result: Timeline, ctx: ExtractCtx, loopState: LoopState): void {
  const inQueue = (g: unknown) => g != null && nameKey(g) === nameKey(ctx.queueName);
  if (inQueue(e.newValue)) {
    result.assignTimeUtcIso = epochMsToUtcIso(e.atEpoch);
    result.lastQueueEntryEpoch = e.atEpoch;
  }
  loopState.currentGroup = e.newValue;
}

function handleAssignmentEvent(e: Event, result: Timeline, ctx: ExtractCtx, loopState: LoopState): void {
  if (loopState.memberSet.has(nameKey(e.newValue))) {
    loopState.memberAssignments.push(e.atEpoch);
  }
}

function handleStateEvent(e: Event, result: Timeline, ctx: ExtractCtx, loopState: LoopState): void {
  const inQueue = (g: unknown) => g != null && nameKey(g) === nameKey(ctx.queueName);
  if (!inQueue(loopState.currentGroup)) return;

  const toLabel = resolveLabel(ctx.stateMap, e.newValue).toLowerCase();
  const fromLabel = resolveLabel(ctx.stateMap, e.oldValue).toLowerCase();

  if (toLabel === "on hold" && fromLabel !== "on hold") {
    result.onHoldCount++;
    if (!result.suspendTimeUtcIso) {
      result.suspendTimeUtcIso = epochMsToUtcIso(e.atEpoch);
      loopState.suspendEpoch = e.atEpoch;
    }
  }

  if (loopState.suspendEpoch && e.atEpoch >= loopState.suspendEpoch) {
    if (toLabel === "in progress") {
      result.resumeTimeUtcIso = epochMsToUtcIso(e.atEpoch);
      result.resumeSource = "In Progress";
    } else if (toLabel === "resolved") {
      result.resumeTimeUtcIso = epochMsToUtcIso(e.atEpoch);
      result.resumeSource = "Resolved";
    }
  }
}

function resolveAcknTime(result: Timeline, memberAssignments: number[]): void {
  if (result.lastQueueEntryEpoch === null) return;
  const entryEpoch: number = result.lastQueueEntryEpoch;
  const valid = memberAssignments.filter(atEpoch => atEpoch >= entryEpoch);
  if (valid.length) {
    result.acknTimeUtcIso = epochMsToUtcIso(Math.min(...valid));
  }
}

function clampAssignTime(result: Timeline, ctx: ExtractCtx): void {
  const bornEpoch = utcRawToEpochMs(ctx.openedAtUtcRaw);
  if (!Number.isFinite(bornEpoch)) return;
  const a = utcRawToEpochMs(String(result.assignTimeUtcIso || ""));
  if (Number.isFinite(a) && a < bornEpoch) {
    result.assignTimeUtcIso = epochMsToUtcIso(bornEpoch);
  }
}

function extractTimelines(auditRows: AuditRowLike[] | null | undefined, ctx: ExtractCtx): Timeline {
  const events = normalizeEvents(auditRows);
  const result = createResult();
  const memberSet = new Set((ctx.memberNames || []).map(nameKey));

  const loopState: LoopState = {
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

type SnValue = string | { display_value?: string; value?: string } | null | undefined;

function fieldValue(v: SnValue | unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") return (v as { display_value?: string; value?: string }).display_value || (v as { display_value?: string; value?: string }).value || "";
  return "";
}

function rawValue(v: SnValue | unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") return (v as { display_value?: string; value?: string }).value || "";
  return "";
}

export type AnalyzedRow = {
  sysId: string | null;
  number: string;
  shortDescription: string;
  state: string;
  stateValue: string;
  priority: string;
  priorityValue: string;
  category: string;
  caller: string;
  assignmentGroup: string;
  assignedTo: string;
  assignedToSysId: string;
  updatedOn: string;
  updatedBy: string;
  configItem: string;
  createdOn: string;
  incidentState: string;
  resolvedAt: string;
  resolvedAtRaw: string;
  openedAt: string;
  openedAtRaw: string;
  closedAt: string;
  closedAtRaw: string;
  closeCode: string;
  closeNotes: string;
  workNotes: string;
  comments: string;
  assignTimeUtcIso: string;
  acknTimeUtcIso: string;
  suspendTimeUtcIso: string;
  resumeTimeUtcIso: string;
  resumeSource: string;
  onHoldCount: number;
  activity: Array<{ f: string | undefined; o: string; n: string; atEpoch: number }>;
};

export type AnalyzeResult = { rows: AnalyzedRow[]; missingAudit: number };

export type QueueCtx = {
  membersByQueue?: Record<string, string[]>;
  fallbackMembers?: string[];
  tableName?: string;
};

function analyzeAll(
  records: Array<Record<string, unknown>>,
  auditByTicket: Record<string, unknown>,
  stateMap: Record<string, string>,
  queueCtx: QueueCtx | null | undefined
): AnalyzeResult {
  const membersByQueue = (queueCtx && queueCtx.membersByQueue) || {};
  const fallbackMembers = (queueCtx && queueCtx.fallbackMembers) || [];
  const tableName = (queueCtx && queueCtx.tableName) || "";
  const isIncident = tableName === "incident";
  const out: AnalyzedRow[] = [];
  let missingAudit = 0;
  for (const rec of records) {
    const snapshotGroupName = fieldValue(rec.assignment_group);
    const sysIdRec = rec.sys_id as { value?: string; display_value?: string } | null | undefined;
    const sysId = typeof rec.sys_id === "object" && sysIdRec
      ? (sysIdRec.value || sysIdRec.display_value)
      : rec.sys_id;
    const sysIdStr = typeof sysId === "string" ? sysId : null;
    const rows = sysIdStr ? (auditByTicket[sysIdStr] as AuditRowLike[] | undefined) : undefined;
    if (!rows) missingAudit++;
    const t = extractTimelines(rows, {
      stateMap,
      queueName: nameKey(snapshotGroupName),
      memberNames: membersByQueue[nameKey(snapshotGroupName)] || fallbackMembers,
      snapshotGroupName,
      openedAtUtcRaw: rawValue(rec.opened_at)
    });
    const stateLabel = fieldValue(rec.state).toLowerCase();
    if (!isIncident) {
      t.suspendTimeUtcIso = null;
      t.resumeTimeUtcIso = null;
      t.resumeSource = null;
    } else if (!stateLabel.startsWith("close") && !stateLabel.startsWith("resolv")) {
      t.suspendTimeUtcIso = null;
      t.resumeTimeUtcIso = null;
      t.resumeSource = null;
    }
    const activity = (rows || [])
      .map(r => {
        const ms = parseUtc(r.at);
        return {
          f: r.field,
          o: String(r.oldValue ?? ""),
          n: String(r.newValue ?? ""),
          atEpoch: Number.isFinite(ms) ? ms : null
        };
      })
      .filter(e => e.atEpoch !== null)
      .map(e => ({ f: e.f, o: e.o, n: e.n, atEpoch: e.atEpoch as number }))
      .sort((a, b) => b.atEpoch - a.atEpoch)
      .slice(0, 500);
    out.push({
      sysId: sysIdStr,
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
      assignTimeUtcIso: t.assignTimeUtcIso || "",
      acknTimeUtcIso: t.acknTimeUtcIso || "",
      suspendTimeUtcIso: t.suspendTimeUtcIso || "",
      resumeTimeUtcIso: t.resumeTimeUtcIso || "",
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

const ACTIVITY_DT_RE = /(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4}|\d{1,2}\/\d{1,2}\/\d{4})[ T](\d{1,2}:\d{2}(?::\d{2})?)\s*([AaPp][Mm])?/g;

function scanSnDateTime(text: unknown): string {
  const re = new RegExp(ACTIVITY_DT_RE.source, "g");
  let m;
  while ((m = re.exec(String(text || ""))) !== null) {
    const ms = parseSnDisplayMs(`${m[1]} ${m[2]}${m[3] ? " " + m[3] : ""}`);
    if (ms != null && Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return "";
}

function cleanCapture(s: unknown): string {
  return String(s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\\+/g, "")
    .replace(/^["'\s]+|["'\s,.;]+$/g, "")
    .trim();
}

type ActivityChange = {
  field: string;
  oldValue: string;
  newValue: string;
  at: string;
};

function extractEventsFromActivity(entries: unknown[]): ActivityChange[] {
  const out: ActivityChange[] = [];
  const seen = new Set<string>();
  for (const entry of entries || []) {
    if (!entry || typeof entry !== "object") continue;

    const changes = Array.isArray((entry as { changes?: unknown }).changes) ? (entry as { changes: unknown[] }).changes : null;
    if (changes) {
      for (const ch of changes) {
        if (!ch || typeof ch !== "object") continue;
        const c = ch as Record<string, unknown>;
        const label = String(c.label ?? c.field_label ?? "").toLowerCase();
        const anchor = ACTIVITY_ANCHORS.find(a => a.labels.some(l => label === l));
        if (!anchor) continue;
        const atIso = scanSnDateTime(JSON.stringify(ch)) ||
          scanSnDateTime(JSON.stringify(entry));
        const ev = {
          field: anchor.field,
          oldValue: cleanCapture(c.old_value ?? c.old ?? c.from ?? ""),
          newValue: cleanCapture(c.new_value ?? c.new ?? c.to ?? ""),
          at: atIso
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
        const atIso = scanSnDateTime(window);
        if (!atIso) break;
        const ev = {
          field: anchor.field,
          oldValue: cleanCapture(m[1]),
          newValue: cleanCapture(m[2]),
          at: atIso
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

type ListHistoryRow = ActivityChange & { at: string };

type ListHistoryEntry = {
  document_id?: unknown;
  sys_created_on?: unknown;
  entries?: { changes?: Array<Record<string, unknown>> };
};

function extractEventsFromListHistory(payload: { entries?: ListHistoryEntry[] } | null | undefined): Record<string, ListHistoryRow[]> {
  const byTicket: Record<string, ListHistoryRow[]> = {};
  for (const entry of payload?.entries || []) {
    if (!entry || typeof entry !== "object") continue;
    const docId = String(entry.document_id || "").trim();
    if (!docId) continue;
    const at = String(entry.sys_created_on || "").trim();
    if (!at) continue;
    for (const ch of (entry.entries?.changes || [])) {
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
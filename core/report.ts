import { pairOffsetMs } from "../core/sntime.ts";

const SLA_TABLE: Record<number, { min: number; max: number }> = {
  1: { min: 1, max: 4 },
  2: { min: 2, max: 8 },
  3: { min: 9, max: 45 },
  4: { min: 90, max: 135 }
};

const RESPONSE_SLA_TABLE: Record<number, number> = {
  1: 0.08333,
  2: 0.25,
  3: 2,
  4: 3
};

function deriveType(refNum: string | null | undefined): string {
  const s = String(refNum || "");
  if (s.startsWith("INC")) return "Incident";
  if (s.startsWith("REQ")) return "RFS";
  if (s.startsWith("SCTASK")) return "RFS";
  if (s.startsWith("PRB")) return "Problem Record";
  if (s.startsWith("PTASK")) return "Problem Record";
  return "";
}

function slaPriority(priority: unknown): number {
  let n = parseInt(String(priority));
  if (!Number.isFinite(n)) return 0;
  if (n > 4) n = 4;
  return SLA_TABLE[n] ? n : 0;
}

function metSLA(value: unknown, priority: unknown, threshold: "min" | "max"): string {
  const p = slaPriority(priority);
  if (!p) return "";
  const v = parseFloat(String(value));
  if (isNaN(v)) return "";
  return v < SLA_TABLE[p][threshold] ? "YES" : "NO";
}

function hmsToHours(hms: unknown): number {
  if (!hms && hms !== 0) return 0;
  const parts = String(hms).split(":");
  if (parts.length < 2) return parseFloat(String(hms)) || 0;
  return parseInt(parts[0]) + parseInt(parts[1]) / 60 + (parseInt(parts[2]) || 0) / 3600;
}

function hoursToHMS(decimalHours: unknown): string {
  if (decimalHours === "" || decimalHours === "0" || isNaN(parseFloat(String(decimalHours)))) return "";
  const totalSecs = Math.round(parseFloat(String(decimalHours)) * 3600);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function normDisplay(v: unknown): string {
  if (!v) return "";
  const s = String(v).trim().replace("T", " ").replace(/\.\d+Z?$/, "").replace(/Z$/, "");
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ ](\d{2}:\d{2}(?::\d{2})?)$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]} ${m[4]}`;
  m = s.match(/^(\d{2})-(\d{2})-(\d{4})[ ](\d{2}:\d{2}(?::\d{2})?)$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}`;
  return s;
}

/**
 * Parse an instance-display wall-clock string ("dd-MM-yyyy HH:mm:ss") into a
 * Date whose `getUTC*` fields reproduce the displayed wall-clock, independent
 * of the browser's timezone. All business-hours math uses `getUTC*`/`Date.UTC`
 * in this same projected space, so results match the instance clock regardless
 * of where the extension runs (fixes issues/003-report-tz-bug.md).
 */
function parseDisplayWallClock(str: string): Date | null {
  if (!str) return null;
  const [datePart, timePart] = String(str).trim().split(/\s+/);
  const [dd, mm, yyyy] = datePart.split("-");
  if (!yyyy || !mm || !dd) return null;
  const [h = 0, mi = 0, s = 0] = String(timePart || "").split(":").map(Number);
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, h, mi, s));
  return isNaN(d.getTime()) ? null : d;
}

function businessHoursBetween(startStr: string | Date, endStr: string | Date): number {
  const start = typeof startStr === "string" ? parseDisplayWallClock(startStr) : startStr;
  const end = typeof endStr === "string" ? parseDisplayWallClock(endStr) : endStr;
  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) return 0;

  const WORK_START_H = 8;
  const WORK_END_H = 17;

  function isWorkday(d: Date) { const day = d.getUTCDay(); return day !== 0 && day !== 6; }

  let hours = 0;
  const startDayEpoch = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDayEpoch = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());

  for (let d = new Date(startDayEpoch); d.getTime() <= endDayEpoch; d.setUTCDate(d.getUTCDate() + 1)) {
    if (!isWorkday(d)) continue;
    const ws = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), WORK_START_H));
    const we = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), WORK_END_H));
    const segStart = d.getTime() === startDayEpoch ? new Date(Math.min(Math.max(start.getTime(), ws.getTime()), we.getTime())) : ws;
    const segEnd = d.getTime() === endDayEpoch ? new Date(Math.min(Math.max(end.getTime(), ws.getTime()), we.getTime())) : we;
    if (segEnd > segStart) hours += (segEnd.getTime() - segStart.getTime()) / 3600000;
  }
  return hours;
}

function calcBusinessHours(
  createdStr: string | null | undefined,
  resolvedStr: string | null | undefined,
  suspendedStr: string | null | undefined,
  resumedStr: string | null | undefined,
  priority: unknown,
  offsetMs = 0
): string {
  const p = slaPriority(priority);
  const start = parseDisplayWallClock(String(createdStr || ""));
  if (!start) return "";

  const end = resolvedStr ? parseDisplayWallClock(resolvedStr) : new Date(Date.now() + offsetMs);
  if (!end) return "";

  if (p === 1 || p === 2) {
    return Math.max(0, (end.getTime() - start.getTime()) / 3600000).toFixed(2);
  }

  let hours = businessHoursBetween(start, end);

  if (suspendedStr && resumedStr) {
    const suspended = parseDisplayWallClock(suspendedStr);
    const resumed = parseDisplayWallClock(resumedStr);
    if (suspended && resumed) {
      hours -= businessHoursBetween(suspended, resumed);
    }
  }

  return Math.max(0, hours).toFixed(2);
}

function calcIncCurrentHours(
  assignedStr: string | null | undefined,
  resolvedStr: string | null | undefined,
  suspendedStr: string | null | undefined,
  resumedStr: string | null | undefined,
  priority: unknown,
  offsetMs = 0
): string {
  if (!assignedStr) return "0";
  const p = slaPriority(priority);
  const start = parseDisplayWallClock(assignedStr);
  if (!start) return "0";

  if (p === 1 || p === 2) {
    const end = resolvedStr ? parseDisplayWallClock(resolvedStr) : new Date(Date.now() + offsetMs);
    if (!end) return "0";
    return Math.max(0, (end.getTime() - start.getTime()) / 3600000).toFixed(2);
  }

  let end;
  if (resolvedStr) {
    end = parseDisplayWallClock(resolvedStr);
  } else if (!suspendedStr) {
    end = new Date(Date.now() + offsetMs);
  } else if (!resumedStr) {
    end = parseDisplayWallClock(suspendedStr);
  } else {
    end = new Date(Date.now() + offsetMs);
  }
  if (!end) return "0";

  let hours = businessHoursBetween(start, end);

  if (suspendedStr && resumedStr) {
    const suspended = parseDisplayWallClock(suspendedStr);
    const resumed = parseDisplayWallClock(resumedStr);
    if (suspended && resumed) {
      hours -= businessHoursBetween(suspended, resumed);
    }
  }

  return Math.max(0, hours).toFixed(2);
}

function calcResponseSLA(
  assignedStr: string | null | undefined,
  acknowledgedStr: string | null | undefined,
  suspendedStr: string | null | undefined,
  resumedStr: string | null | undefined,
  priority: unknown,
  offsetMs = 0
): string {
  if (!assignedStr) return "";
  const p = slaPriority(priority);
  const start = parseDisplayWallClock(assignedStr);
  if (!start) return "";
  const end = acknowledgedStr ? parseDisplayWallClock(acknowledgedStr) : new Date(Date.now() + offsetMs);
  if (!end) return "";

  if (p === 1 || p === 2) {
    return hoursToHMS(Math.max(0, (end.getTime() - start.getTime()) / 3600000));
  }

  let hours = businessHoursBetween(start, end);
  if (suspendedStr && resumedStr) {
    const suspended = parseDisplayWallClock(suspendedStr);
    const resumed = parseDisplayWallClock(resumedStr);
    if (suspended && resumed) {
      const resumedCapped = new Date(Math.min(resumed.getTime(), end.getTime()));
      hours -= businessHoursBetween(suspended, resumedCapped);
    }
  }
  return hoursToHMS(Math.max(0, hours));
}

function calcTotalAgeDays(businessHoursDecimal: unknown): string {
  const h = parseFloat(String(businessHoursDecimal));
  if (isNaN(h)) return "";
  return (h / 9).toFixed(2);
}

function analysedDateString(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(now.getDate())}/${p(now.getMonth() + 1)}/${now.getFullYear()}`;
}

export type ReportRow = {
  number: string;
  priority: string | number;
  state?: string;
  assignmentGroup?: string;
  createdOn?: string;
  assignTimeUtcIso?: string;
  acknTimeUtcIso?: string;
  resolvedAt?: string;
  suspendTimeUtcIso?: string;
  resumeTimeUtcIso?: string;
  openedAt?: string;
  openedAtRaw?: string;
  configItem?: string;
  solutionType?: string;
  rootCause?: string;
  __reportKey?: string;
  __report?: Report;
};

export type WalkedRow = ReportRow & {
  __report?: Report;
  __reportKey?: string;
};

export type Report = {
  type: string;
  opCo: string;
  domain: string;
  created: string;
  assigned: string;
  ackn: string;
  resolved: string;
  susp: string;
  resumed: string;
  impactedApplication: string;
  resolutionType: string;
  rootCauseCategory: string;
  incidentHours: string;
  incidentTotalAge: string;
  incCurrentHours: string;
  incidentCurrentAge: string;
  responseSLA: string;
  cumulativeSla: string;
  cumulativeDays: string;
  timeTaken: string;
  metResponseSLA: string;
  metMinResolutionSLA: string;
  metMaxResolutionSLA: string;
  slaBreach: string;
  analysedDate: string;

  // Optional derivation detail (filled by buildReport for the Calclens drawer).
  // These expose the same numbers already computed during the build so the
  // explainer can show real arithmetic without re-deriving (keeps the TZ
  // contract single-sourced).
  respHours?: number;
  respTarget?: number;
  incHoursRaw?: number;
  incCurrentRaw?: number;
  resMinTarget?: number;
  resMaxTarget?: number;
  metMin?: string;
  metMax?: string;
  createdClock?: string;
  assignedClock?: string;
  acknClock?: string;
  resolvedClock?: string;
};

export type MessageFormatter = (v: string) => string;

/**
 * SLA/hours calculations only apply to incidents that have reached a terminal
 * state. A row is eligible when its number is an incident (INC prefix) and its
 * state label starts with "close" or "resolv" (case-insensitive) — the same
 * terminal-state rule used by the grid's breach marker and the reopen logic.
 * Non-eligible rows (non-incidents, or open/in-progress incidents) get blank
 * SLA/hours fields.
 */
export function isSlaEligible(row: WalkedRow): boolean {
  const isIncident = String(row.number ?? "").startsWith("INC");
  const state = String(row.state ?? "").trim().toLowerCase();
  const terminal = state.startsWith("close") || state.startsWith("resolv");
  return isIncident && terminal;
}

export function buildReport(row: WalkedRow, fmt?: MessageFormatter | null, now: Date = new Date(), opts?: { skipSlaGate?: boolean }): Report {
  const keyInputs = [
    row.number, row.priority, row.state, row.assignmentGroup,
    row.createdOn, row.assignTimeUtcIso, row.acknTimeUtcIso, row.resolvedAt,
    row.suspendTimeUtcIso, row.resumeTimeUtcIso,
    row.solutionType, row.rootCause
  ].join("|");
  // The gated result is what every surface reads and is what we cache. The
  // ungated variant (skipSlaGate) is an internal-only path (SLA summary problem
  // block) and must neither read nor write that cache.
  const skipGate = opts?.skipSlaGate === true;
  if (!skipGate && row.__reportKey === keyInputs && row.__report) return row.__report;

  const type = deriveType(row.number);
  const created = normDisplay(row.createdOn);
  const assigned = normDisplay(fmt ? fmt(String(row.assignTimeUtcIso || "")) : row.assignTimeUtcIso);
  const ackn = normDisplay(fmt ? fmt(String(row.acknTimeUtcIso || "")) : row.acknTimeUtcIso);
  const resolved = normDisplay(row.resolvedAt);
  const susp = normDisplay(fmt ? fmt(String(row.suspendTimeUtcIso || "")) : row.suspendTimeUtcIso);
  const resumed = normDisplay(fmt ? fmt(String(row.resumeTimeUtcIso || "")) : row.resumeTimeUtcIso);
  const instanceOffsetMs = pairOffsetMs(row.openedAt || "", row.openedAtRaw || "") || 0;

  const incidentHoursRaw =   calcBusinessHours(created, resolved, susp, resumed, row.priority, instanceOffsetMs);
  const incidentHours = hoursToHMS(incidentHoursRaw);
  const incidentTotalAge = calcTotalAgeDays(incidentHoursRaw);
  const incCurrentHoursRaw = calcIncCurrentHours(assigned, resolved, susp, resumed, row.priority, instanceOffsetMs);
  const incCurrentHours = hoursToHMS(incCurrentHoursRaw);
  const incidentCurrentAge = calcTotalAgeDays(incCurrentHoursRaw);
  const responseSLA = calcResponseSLA(assigned, ackn, susp, resumed, row.priority, instanceOffsetMs);
  const respVal = responseSLA === "" ? NaN : hmsToHours(responseSLA);
  const respThreshold = RESPONSE_SLA_TABLE[slaPriority(row.priority)] || 0;
  const metResponse = isNaN(respVal) || !respThreshold ? "" : (respVal < respThreshold ? "YES" : "No");
  const incVal = parseFloat(incCurrentHoursRaw);
  const metMin = isNaN(incVal) ? "" : metSLA(incVal, row.priority, "min");
  const metMax = isNaN(incVal) ? "" : metSLA(incVal, row.priority, "max");
  const breached: string[] = [];
  if (metResponse === "No") breached.push("R");
  if (metMax === "NO") breached.push("M");

  const rep: Report = {
    type,
    opCo: "BA",
    domain: "AO",
    created, assigned, ackn, resolved, susp, resumed,
    impactedApplication: String(row.configItem || ""),
    resolutionType: String(row.solutionType || ""),
    rootCauseCategory: String(row.rootCause || ""),
    incidentHours,
    incidentTotalAge,
    incCurrentHours,
    incidentCurrentAge,
    responseSLA,
    cumulativeSla: incCurrentHours,
    cumulativeDays: incidentCurrentAge,
    timeTaken: incCurrentHours,
    metResponseSLA: metResponse,
    metMinResolutionSLA: metMin,
    metMaxResolutionSLA: metMax,
    slaBreach: breached.join(""),
    analysedDate: analysedDateString(now),

    respHours: Number.isNaN(respVal) ? undefined : respVal,
    respTarget: respThreshold || undefined,
    incHoursRaw: Number.isNaN(parseFloat(incidentHoursRaw)) ? undefined : parseFloat(incidentHoursRaw),
    incCurrentRaw: Number.isNaN(incVal) ? undefined : incVal,
    resMinTarget: slaPriority(row.priority) ? SLA_TABLE[slaPriority(row.priority)].min : undefined,
    resMaxTarget: slaPriority(row.priority) ? SLA_TABLE[slaPriority(row.priority)].max : undefined,
    metMin,
    metMax,
    createdClock: created,
    assignedClock: assigned,
    acknClock: ackn,
    resolvedClock: resolved
  };

  // Gate: SLA/hours calculations only apply to closed/resolved incidents.
  // For every other row blank the derived SLA fields (passthrough label/time
  // fields are kept). Done at assembly so the calc functions stay unchanged.
  if (!skipGate && !isSlaEligible(row)) {
    rep.incidentHours = "";
    rep.incidentTotalAge = "";
    rep.incCurrentHours = "";
    rep.incidentCurrentAge = "";
    rep.responseSLA = "";
    rep.cumulativeSla = "";
    rep.cumulativeDays = "";
    rep.timeTaken = "";
    rep.metResponseSLA = "";
    rep.metMinResolutionSLA = "";
    rep.metMaxResolutionSLA = "";
    rep.slaBreach = "";
    rep.respHours = undefined;
    rep.respTarget = undefined;
    rep.incHoursRaw = undefined;
    rep.incCurrentRaw = undefined;
    rep.resMinTarget = undefined;
    rep.resMaxTarget = undefined;
    rep.metMin = undefined;
    rep.metMax = undefined;
  }

  if (!skipGate) {
    row.__reportKey = keyInputs;
    row.__report = rep;
  }
  return rep;
}

/** Response SLA target (in business hours) for a priority, or 0 if unknown. */
export function responseTargetHours(priority: unknown): number {
  return RESPONSE_SLA_TABLE[slaPriority(priority)] || 0;
}

/** Resolution SLA target window (min/max business hours) for a priority, or 0s. */
export function resolutionTargetHours(priority: unknown): { min: number; max: number } {
  const p = slaPriority(priority);
  return p ? SLA_TABLE[p] : { min: 0, max: 0 };
}

export {
  deriveType, slaPriority, metSLA, hmsToHours, normDisplay, businessHoursBetween,
  calcBusinessHours, calcIncCurrentHours, calcResponseSLA
};
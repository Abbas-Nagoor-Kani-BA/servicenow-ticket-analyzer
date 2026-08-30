import { pairOffsetMs } from "../core/sntime.js";

const SLA_TABLE = {
  1: { min: 1, max: 4 },
  2: { min: 2, max: 8 },
  3: { min: 9, max: 45 },
  4: { min: 90, max: 135 }
};

const RESPONSE_SLA_TABLE = {
  1: 0.08333,
  2: 0.25,
  3: 2,
  4: 3
};

function deriveType(refNum) {
  const s = String(refNum || "");
  if (s.startsWith("INC")) return "Incident";
  if (s.startsWith("REQ")) return "RFS";
  if (s.startsWith("PTASK")) return "Problem";
  return "";
}

function slaPriority(priority) {
  let n = parseInt(String(priority));
  if (!Number.isFinite(n)) return 0;
  if (n > 4) n = 4;
  return SLA_TABLE[n] ? n : 0;
}

function metSLA(value, priority, threshold) {
  const p = slaPriority(priority);
  if (!p) return "";
  const v = parseFloat(value);
  if (isNaN(v)) return "";
  return v < SLA_TABLE[p][threshold] ? "YES" : "NO";
}

function hmsToHours(hms) {
  if (!hms && hms !== 0) return 0;
  const parts = String(hms).split(":");
  if (parts.length < 2) return parseFloat(hms) || 0;
  return parseInt(parts[0]) + parseInt(parts[1]) / 60 + (parseInt(parts[2]) || 0) / 3600;
}

function hoursToHMS(decimalHours) {
  if (decimalHours === "" || decimalHours === "0" || isNaN(parseFloat(decimalHours))) return "";
  const totalSecs = Math.round(parseFloat(decimalHours) * 3600);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function normDisplay(v) {
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
 * @param {string} str
 */
function parseDisplayWallClock(str) {
  if (!str) return null;
  const [datePart, timePart] = String(str).trim().split(/\s+/);
  const [dd, mm, yyyy] = datePart.split("-");
  if (!yyyy || !mm || !dd) return null;
  const [h = 0, mi = 0, s = 0] = String(timePart || "").split(":").map(Number);
  const d = new Date(Date.UTC(+yyyy, +mm - 1, +dd, h, mi, s));
  return isNaN(d.getTime()) ? null : d;
}

function businessHoursBetween(startStr, endStr) {
  const start = typeof startStr === "string" ? parseDisplayWallClock(startStr) : startStr;
  const end = typeof endStr === "string" ? parseDisplayWallClock(endStr) : endStr;
  if (!start || !end || isNaN(start) || isNaN(end)) return 0;

  const WORK_START_H = 8;
  const WORK_END_H = 17;

  function isWorkday(d) { const day = d.getUTCDay(); return day !== 0 && day !== 6; }

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

function calcBusinessHours(createdStr, resolvedStr, suspendedStr, resumedStr, priority, offsetMs = 0) {
  const p = slaPriority(priority);
  const start = parseDisplayWallClock(createdStr);
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

function calcIncCurrentHours(assignedStr, resolvedStr, suspendedStr, resumedStr, priority, offsetMs = 0) {
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

function calcResponseSLA(assignedStr, acknowledgedStr, suspendedStr, resumedStr, priority, offsetMs = 0) {
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

function calcTotalAgeDays(businessHoursDecimal) {
  const h = parseFloat(businessHoursDecimal);
  if (isNaN(h)) return "";
  return (h / 9).toFixed(2);
}

function analysedDateString(now = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return `${p(now.getDate())}/${p(now.getMonth() + 1)}/${now.getFullYear()}`;
}

function buildReport(row, fmt, now = new Date()) {
  const keyInputs = [
    row.number, row.priority, row.state, row.assignmentGroup,
    row.createdOn, row.assignTimeUtcIso, row.acknTimeUtcIso, row.resolvedAt,
    row.suspendTimeUtcIso, row.resumeTimeUtcIso
  ].join("|");
  if (row.__reportKey === keyInputs && row.__report) return row.__report;

  const type = deriveType(row.number);
  const created = normDisplay(row.createdOn);
  const assigned = normDisplay(fmt ? fmt(row.assignTimeUtcIso) : row.assignTimeUtcIso);
  const ackn = normDisplay(fmt ? fmt(row.acknTimeUtcIso) : row.acknTimeUtcIso);
  const resolved = normDisplay(row.resolvedAt);
  const susp = normDisplay(fmt ? fmt(row.suspendTimeUtcIso) : row.suspendTimeUtcIso);
  const resumed = normDisplay(fmt ? fmt(row.resumeTimeUtcIso) : row.resumeTimeUtcIso);
  const instanceOffsetMs = pairOffsetMs(row.openedAt, row.openedAtRaw) || 0;

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
  const breached = [];
  if (metResponse === "No") breached.push("R");
  if (metMax === "NO") breached.push("M");

  const rep = {
    type,
    opCo: "BA",
    domain: "AO",
    created, assigned, ackn, resolved, susp, resumed,
    impactedApplication: row.configItem || "",
    resolutionType: row.solutionType || "",
    rootCauseCategory: row.rootCause || "",
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
    analysedDate: analysedDateString(now)
  };

  row.__reportKey = keyInputs;
  row.__report = rep;
  return rep;
}

export {
  deriveType, slaPriority, metSLA, hmsToHours, normDisplay, businessHoursBetween,
  calcBusinessHours, calcIncCurrentHours, calcResponseSLA, buildReport
};

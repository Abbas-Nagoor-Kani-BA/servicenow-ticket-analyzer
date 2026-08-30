/**
 * Derived duration columns.
 *
 * Durations are computed from the four timeline rules' OWN timestamps (UTC ISO
 * on the row), never from the report's instance-clock-formatted dates: an
 * interval is timezone-independent, so this keeps the timezone contract
 * single-sourced. Format is the report's HMS convention (e.g. "8:00:00");
 * an empty string means the endpoint pair was missing, inverted, or zero.
 *
 * suspendTotal is the rules' first suspend -> first resume window; the four
 * rules expose no other suspension timestamps, so multi-hold tickets
 * undercount by design until the rules track every hold.
 */

export type Durations = {
  assignToAckn: string;
  assignToResolve: string;
  suspendTotal: string;
};

export type DurationRow = {
  assignTimeUtcIso?: unknown;
  acknTimeUtcIso?: unknown;
  resumeTimeUtcIso?: unknown;
  suspendTimeUtcIso?: unknown;
  resolvedAtRaw?: unknown;
};

function parseUtcMs(s: unknown): number {
  const str = String(s ?? "").trim().replace(" ", "T");
  if (!str) return NaN;
  return Date.parse(/(Z|[+-]\d\d:?\d\d)$/.test(str) ? str : str + "Z");
}

function hoursToHMS(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return "";
  const totalSecs = Math.round(h * 3600);
  const hh = Math.floor(totalSecs / 3600);
  const mm = Math.floor((totalSecs % 3600) / 60);
  const ss = totalSecs % 60;
  return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function durMs(end: number, start: number): number {
  return Number.isFinite(end) && Number.isFinite(start) && end >= start
    ? (end - start) / 3600e3
    : NaN;
}

export function computeDurations(row: DurationRow): Durations {
  const assign = parseUtcMs(row.assignTimeUtcIso);
  const ackn = parseUtcMs(row.acknTimeUtcIso);
  const resolved = parseUtcMs(row.resolvedAtRaw);
  const suspend = parseUtcMs(row.suspendTimeUtcIso);
  const resume = parseUtcMs(row.resumeTimeUtcIso);
  return {
    assignToAckn: hoursToHMS(durMs(ackn, assign)),
    assignToResolve: hoursToHMS(durMs(resolved, assign)),
    suspendTotal: hoursToHMS(durMs(resume, suspend))
  };
}

export { hoursToHMS, parseUtcMs };
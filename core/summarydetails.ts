import { parseSnDisplayMs } from "./sntime.ts";
import { displayToSerial } from "./msrchoices.ts";

// ---------------------------------------------------------------------------
// Weekly Status Report "Summary" sheet derivation (pure domain, no I/O).
//
//   - Key Incidents          : P1/P2 incidents resolved LAST week (from the
//                               already-pulled incident rows in the data view)
//   - Changes Implemented     : change_request start_date in LAST week,
//                               not failed and not cancelled
//   - Changes Failed          : change_request start_date in LAST week with
//                               review_status = fail
//   - Changes Planned         : change_request start_date in NEXT week
//
// The pull issues one scoped request per week (last, next) keyed on
// start_date, so bucketing here is by start_date only. Weeks are Monday-Sunday.
// Dates are emitted as Excel serial numbers (the template's date cells store
// serials like 46253.68), or null when unparseable. Everything else on the
// Summary sheet is human-authored narrative left for the editable section.
// ---------------------------------------------------------------------------

/** A ServiceNow field value in either raw string or {display_value,value} form. */
export type SnField = string | { display_value?: string; value?: string } | null | undefined;

/** Loose record — a raw SN record or an already-analysed row. */
export type SummarySourceRow = Record<string, unknown>;

export type Window = {
  /** Monday 00:00 local, YYYY-MM-DD */
  from: string;
  /** Sunday, YYYY-MM-DD */
  to: string;
  /** Epoch ms of Monday 00:00:00.000 (local). */
  fromMs: number;
  /** Epoch ms of Sunday 23:59:59.999 (local). */
  toMs: number;
};

export type WeekRanges = {
  last: Window;
  current: Window;
  next: Window;
};

export type KeyIncidentRow = {
  resolutionDate: number | null;
  systemArea: string;
  incidentNumber: string;
  details: string;
  status: string;
  rootCauseResolution: string;
};

export type ChangeRow = {
  date: number | null;
  systemArea: string;
  crNumber: string;
  details: string;
};

export type SummaryDetails = {
  weeks: WeekRanges;
  keyIncidents: KeyIncidentRow[];
  changesImplemented: ChangeRow[];
  changesPlanned: ChangeRow[];
  changesFailed: ChangeRow[];
};

function display(v: SnField | unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as { display_value?: string; value?: string };
    return o.display_value || o.value || "";
  }
  return String(v);
}

function raw(v: SnField | unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const o = v as { display_value?: string; value?: string };
    return o.value || o.display_value || "";
  }
  return String(v);
}

/** Reads a field by any of the given aliases, preferring display text. */
function pick(row: SummarySourceRow, keys: string[]): string {
  for (const k of keys) {
    if (k in row) {
      const s = display(row[k]);
      if (s) return s;
    }
  }
  return "";
}

function pickRaw(row: SummarySourceRow, keys: string[]): string {
  for (const k of keys) {
    if (k in row) {
      const s = raw(row[k]);
      if (s) return s;
    }
  }
  return "";
}

const fmtDate = (x: Date): string =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

/** Monday-Sunday window whose Monday is `mondayOffsetDays` from this week's Monday. */
function windowFrom(base: Date, mondayOffsetDays: number): Window {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const dow = d.getDay(); // 0=Sun..6=Sat
  const backToMonday = dow === 0 ? 6 : dow - 1;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - backToMonday + mondayOffsetDays);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  // Bounds are UTC epoch ms because inWindow compares them against
  // parseSnDisplayMs(start_date), which interprets the SN display datetime as
  // UTC. Building bounds with getTime() (local) instead would offset the two
  // clocks and silently drop rows near the Mon-morning / Sun-night boundary.
  return {
    from: fmtDate(monday),
    to: fmtDate(sunday),
    fromMs: Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate(), 0, 0, 0, 0),
    toMs: Date.UTC(sunday.getFullYear(), sunday.getMonth(), sunday.getDate(), 23, 59, 59, 999)
  };
}

/**
 * Last, current and next Monday-Sunday weeks relative to `now`. Uses local date
 * parts so boundaries align with the instance clock the report follows.
 */
export function weekRanges(now: Date = new Date()): WeekRanges {
  return {
    last: windowFrom(now, -7),
    current: windowFrom(now, 0),
    next: windowFrom(now, 7)
  };
}

function inWindow(ms: number | null, w: Window): boolean {
  return ms !== null && ms >= w.fromMs && ms <= w.toMs;
}

function serial(v: string): number | null {
  return v ? displayToSerial(v) : null;
}

/**
 * A change is "failed" when its review_status display text signals failure, or
 * the u_failure flag is truthy. review_status is an instance choice field; its
 * exact value is not known offline, so match on the human label containing
 * "fail" / "unsuccess", which is stable across the OOB and custom choices.
 */
function isFailed(row: SummarySourceRow): boolean {
  const rs = pick(row, ["review_status"]).toLowerCase();
  if (/fail|unsuccess/.test(rs)) return true;
  const rsRaw = pickRaw(row, ["review_status"]).toLowerCase();
  if (/fail|unsuccess/.test(rsRaw)) return true;
  const uf = pickRaw(row, ["u_failure"]).trim().toLowerCase();
  return uf === "true" || uf === "1" || uf === "yes";
}

/**
 * A change_request is cancelled when state is raw 4 or its label starts with
 * "cancel" (Cancelled / Canceled). Cancelled changes were not implemented, so
 * they are excluded from the Implemented bucket.
 */
function isCancelled(row: SummarySourceRow): boolean {
  if (pickRaw(row, ["state"]).trim() === "4") return true;
  return pick(row, ["state"]).trim().toLowerCase().startsWith("cancel");
}

function isP1OrP2(row: SummarySourceRow): boolean {
  const rawP = pickRaw(row, ["priority"]).trim();
  if (rawP === "1" || rawP === "2") return true;
  const m = pick(row, ["priority"]).match(/\d+/);
  return m ? m[0] === "1" || m[0] === "2" : false;
}

function changeRow(row: SummarySourceRow, dateStr: string): ChangeRow {
  return {
    date: serial(dateStr),
    systemArea: pick(row, ["cmdb_ci", "configItem", "business_service"]),
    crNumber: pick(row, ["number"]),
    details: pick(row, ["short_description", "shortDescription"])
  };
}

/**
 * Bucket change_request rows by start_date:
 *   - implemented: LAST week, not failed and not cancelled
 *   - failed:      LAST week, review_status = fail
 *   - planned:     NEXT week
 *
 * Failed takes precedence over implemented for last-week rows; cancelled rows
 * are excluded from both. Implemented does NOT require terminal Closed state —
 * a change scheduled/executed last week that has not yet been closed still
 * counts, matching how the weekly report treats "implemented last week".
 * Bucketing is
 * by start_date only (the pull issues one scoped request per week), so no
 * boundary-spanning end_date logic is needed here.
 */
export function bucketChanges(rows: SummarySourceRow[], weeks: WeekRanges): {
  implemented: ChangeRow[];
  planned: ChangeRow[];
  failed: ChangeRow[];
} {
  const implemented: ChangeRow[] = [];
  const planned: ChangeRow[] = [];
  const failed: ChangeRow[] = [];
  for (const row of rows) {
    const startMs = parseSnDisplayMs(pick(row, ["start_date"]));
    const startStr = pick(row, ["start_date"]);
    if (inWindow(startMs, weeks.last)) {
      if (isFailed(row)) {
        failed.push(changeRow(row, startStr));
      } else if (!isCancelled(row)) {
        implemented.push(changeRow(row, startStr));
      }
    } else if (inWindow(startMs, weeks.next)) {
      planned.push(changeRow(row, startStr));
    }
  }
  return { implemented, planned, failed };
}

/** P1/P2 incidents resolved (or closed) during LAST week. */
export function keyIncidents(rows: SummarySourceRow[], weeks: WeekRanges): KeyIncidentRow[] {
  const out: KeyIncidentRow[] = [];
  for (const row of rows) {
    if (!isP1OrP2(row)) continue;
    const dateStr = pick(row, ["resolved_at", "resolvedAt"]) || pick(row, ["closed_at", "closedAt"]);
    if (!inWindow(parseSnDisplayMs(dateStr), weeks.last)) continue;
    out.push({
      resolutionDate: serial(dateStr),
      systemArea: pick(row, ["cmdb_ci", "configItem", "business_service"]),
      incidentNumber: pick(row, ["number"]),
      details: pick(row, ["short_description", "shortDescription"]),
      status: pick(row, ["state"]),
      rootCauseResolution: pick(row, ["close_notes", "closeNotes"])
    });
  }
  return out;
}

/**
 * Derive the full Summary details from a mixed set of source rows.
 *
 * @param incidents analysed/raw incident rows (for Key Incidents)
 * @param changes   raw change_request rows (for the three Changes tables)
 * @param now       reference date for the weeks (defaults to today)
 */
export function buildSummaryDetails(
  incidents: SummarySourceRow[],
  changes: SummarySourceRow[],
  now: Date = new Date()
): SummaryDetails {
  const weeks = weekRanges(now);
  const buckets = bucketChanges(changes || [], weeks);
  return {
    weeks,
    keyIncidents: keyIncidents(incidents || [], weeks),
    changesImplemented: buckets.implemented,
    changesPlanned: buckets.planned,
    changesFailed: buckets.failed
  };
}

/** Fields a change_request pull must request for the Summary tables. */
export const CHANGE_SUMMARY_FIELDS = [
  "sys_id",
  "number",
  "short_description",
  "state",
  "priority",
  "assignment_group",
  "cmdb_ci",
  "business_service",
  "start_date",
  "end_date",
  "review_status",
  "u_failure",
  "close_code",
  "close_notes",
  "sys_updated_on"
];

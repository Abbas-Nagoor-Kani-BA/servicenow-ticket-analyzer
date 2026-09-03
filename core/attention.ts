/**
 * Attention — pure "needs a human look" rule engine.
 *
 * When Calclens is ON the viewer flags tickets that carry a signal worth
 * reviewing. Each rule reads only the resolved viewer row (which includes the
 * retained `activity` timeline events) plus the team membership from Settings.
 * No DOM, no chrome.*, no I/O — same contract as the rest of core/.
 */

import { snStateMap } from "./statechoices.ts";
import type { Report } from "./report.ts";

export type AttentionRuleId =
  | "multiAssignWithinTeam"
  | "multiGroupWithinTeam"
  | "reopened"
  | "slaBreach"
  | "longOnHold"
  | "repeatedOnHold"
  | "slowPickup"
  | "emptyPlan"
  | "lowConfidenceParse";

/**
 * Canonical, ordered list of the attention rules with their human labels.
 *
 * Pure data (no behavior): the single source of truth shared by the highlight
 * toggle UI and its persisted defaults. `slowPickup` emits either "Slow pickup"
 * or "Never acknowledged" as a per-row detail label; here it carries the single
 * stable label "Slow pickup".
 */
export const ATTENTION_RULES: readonly { id: AttentionRuleId; label: string }[] = [
  { id: "multiAssignWithinTeam", label: "Multiple assignments in team" },
  { id: "multiGroupWithinTeam", label: "Moved between queues" },
  { id: "reopened", label: "Reopened" },
  { id: "slaBreach", label: "SLA breached" },
  { id: "longOnHold", label: "Long On Hold" },
  { id: "repeatedOnHold", label: "Held On Hold repeatedly" },
  { id: "slowPickup", label: "Slow pickup" },
  { id: "emptyPlan", label: "Missing plan data" },
  { id: "lowConfidenceParse", label: "Low-confidence parse" }
];

export type AttentionFlag = {
  /** Stable rule id (used by tests and future filters). */
  id: AttentionRuleId;
  /** Short human label shown in the marker tooltip. */
  label: string;
  /** Extra detail, e.g. how many times the ticket bounced. */
  detail: string;
  /** Grid column key(s) this flag relates to — drives per-cell dot markers. */
  columnHint?: string | string[];
};

export type AttentionOpts = {
  /** Configured team-member names (Settings). Used by the multi-assign rules. */
  teamMembers?: string[];
  /** Configured queue names (Settings). Used by the multi-group rule. */
  groupScope?: string[];
  /** Already-computed report (avoids recomputing buildReport per row). */
  report?: Report;
  /** Override the default thresholds/variants. */
  thresholds?: Partial<AttentionThresholds>;
};

export type AttentionThresholds = {
  /** Flag when a ticket was ever assigned to more than this many team members. */
  maxTeamAssignees: number;
  /** Flag when the queue changed more than this many times within scope. */
  maxGroupChanges: number;
  /** Flag when the ticket went On Hold more than this many times. */
  maxOnHoldCount: number;
  /** Flag a single On Hold span longer than this many milliseconds. */
  maxOnHoldSpanMs: number;
  /** Flag when assign→acknowledge elapsed longer than this many milliseconds. */
  maxPickupMs: number;
};

const HOUR_MS = 3600 * 1000;

export const DEFAULT_ATTENTION_THRESHOLDS: AttentionThresholds = {
  maxTeamAssignees: 1,
  maxGroupChanges: 1,
  maxOnHoldCount: 2,
  maxOnHoldSpanMs: 48 * HOUR_MS,
  maxPickupMs: 24 * HOUR_MS
};

function tableForNumber(number: unknown): string {
  const s = String(number ?? "");
  if (s.startsWith("REQ")) return "sc_req_item";
  if (s.startsWith("SCTASK")) return "sc_task";
  if (s.startsWith("PRB")) return "problem";
  if (s.startsWith("PTASK")) return "problem";
  return "incident";
}

/** Resolve a raw or display state value to its display label. */
function stateLabelOf(table: string, v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const map = snStateMap(table);
  return map[s] || map[s.toLowerCase()] || s;
}

const TERMINAL = /^(close|resolv|cancel)/i;
function isTerminalState(label: string): boolean {
  return TERMINAL.test(label);
}

function memberSet(members?: string[]): Set<string> {
  return new Set((members || []).map((m) => String(m).trim().toLowerCase()).filter(Boolean));
}

function isMember(set: Set<string>, name: unknown): boolean {
  const s = String(name ?? "").trim();
  return !!s && set.has(s.toLowerCase());
}

function events(row: Record<string, any>): Array<{ f?: string; o?: string; n?: string; atEpoch?: number }> {
  return Array.isArray(row.activity) ? row.activity : [];
}

function distinctNames(row: Record<string, any>, field: string, set: Set<string>, values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ev of events(row)) {
    if (ev.f !== field) continue;
    for (const v of values) {
      const raw = v === "o" ? ev.o : ev.n;
      if (isMember(set, raw)) {
        const key = String(raw).trim().toLowerCase();
        if (!seen.has(key)) { seen.add(key); out.push(String(raw).trim()); }
      }
    }
  }
  return out;
}

function flag(id: AttentionRuleId, label: string, detail: string, columnHint?: string | string[]): AttentionFlag {
  return { id, label, detail, columnHint };
}

/**
 * Compute the attention flags for one row.
 *
 * @param row the resolved viewer row
 * @param opts team membership, report, thresholds
 * @returns an ordered list of flags; empty when nothing needs attention
 */
export function computeAttention(row: Record<string, any>, opts: AttentionOpts = {}): AttentionFlag[] {
  if (!row || typeof row !== "object") return [];

  const t: AttentionThresholds = { ...DEFAULT_ATTENTION_THRESHOLDS, ...(opts.thresholds || {}) };
  const team = memberSet(opts.teamMembers);
  const groups = memberSet(opts.groupScope);
  const table = tableForNumber(row.number);
  const out: AttentionFlag[] = [];

  // 1. Multiple assignments within the team — distinct team members ever assigned.
  const teamAssignees = distinctNames(row, "assigned_to", team, ["n", "o"]);
  if (teamAssignees.length > t.maxTeamAssignees) {
    out.push(flag("multiAssignWithinTeam", "Multiple assignments in team",
      `Assigned to ${teamAssignees.length} team members: ${teamAssignees.join(", ")}`, "assignedTo"));
  }

  // 2. Multiple queue changes within the team.
  const groupChanges = events(row).filter((ev) => {
    if (ev.f !== "assignment_group") return false;
    if (groups.size === 0) return true;
    return isMember(groups, ev.o) || isMember(groups, ev.n);
  }).length;
  if (groupChanges > t.maxGroupChanges) {
    out.push(flag("multiGroupWithinTeam", "Moved between queues",
      `Queue changed ${groupChanges} times within the selected queues`));
  }

  // 3. Reopened — a terminal state was followed by a non-terminal state.
  let reopened = false;
  for (const ev of events(row)) {
    if (ev.f !== "state") continue;
    const from = stateLabelOf(table, ev.o);
    const to = stateLabelOf(table, ev.n);
    if (isTerminalState(from) && !isTerminalState(to)) reopened = true;
  }
  if (reopened) out.push(flag("reopened", "Reopened", "A closed/resolved ticket went back to an active state", "state"));

  // 4. SLA breach.
  const breach = (opts.report as Record<string, any> | undefined)?.slaBreach;
  if (breach) out.push(flag("slaBreach", "SLA breached", `Breach code: ${String(breach)}`, ["rep:responseSLA", "rep:resolutionSLA"]));

  // 5. Long single On Hold span.
  const suspend = Date.parse(String(row.suspendTimeUtcIso ?? "").replace(" ", "T"));
  const resume = Date.parse(String(row.resumeTimeUtcIso ?? "").replace(" ", "T"));
  if (Number.isFinite(suspend) && Number.isFinite(resume) && resume >= suspend) {
    const span = resume - suspend;
    if (span > t.maxOnHoldSpanMs) {
      const hours = Math.round(span / HOUR_MS);
      out.push(flag("longOnHold", "Long On Hold", `Stayed On Hold ~${hours} hours`, ["suspendTimeUtcIso", "resumeTimeUtcIso"]));
    }
  }

  // 6. Repeated On Hold.
  const holdCount = Number(row.onHoldCount) || 0;
    if (holdCount > t.maxOnHoldCount) {
    out.push(flag("repeatedOnHold", "Held On Hold repeatedly", `Went On Hold ${holdCount} times`, ["suspendTimeUtcIso", "resumeTimeUtcIso"]));
  }

  // 7. Slow pickup — no acknowledgement, or a long assign→acknowledge gap.
  const assignIso = String(row.assignTimeUtcIso ?? "");
  const acknIso = String(row.acknTimeUtcIso ?? "");
  if (assignIso && !acknIso) {
    out.push(flag("slowPickup", "Never acknowledged", "Assigned but no team member ever picked it up", ["assignTimeUtcIso", "acknTimeUtcIso"]));
  } else if (assignIso && acknIso) {
    const a = Date.parse(assignIso.replace(" ", "T"));
    const b = Date.parse(acknIso.replace(" ", "T"));
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a && b - a > t.maxPickupMs) {
      const hours = Math.round((b - a) / HOUR_MS);
      out.push(flag("slowPickup", "Slow pickup", `Took ~${hours} hours to acknowledge`, ["assignTimeUtcIso", "acknTimeUtcIso"]));
    }
  }

  // 8. Empty plan data.
  const missingPlan: string[] = [];
  if (!String(row.rootCause ?? "").trim()) missingPlan.push("root cause");
  if (!String(row.solutionType ?? "").trim()) missingPlan.push("solution type");
  if (missingPlan.length) out.push(flag("emptyPlan", "Missing plan data", `No ${missingPlan.join(" or ")}`, ["rootCause", "solutionType"]));

  // 9. Low-confidence parse.
  if (row.parseReview) out.push(flag("lowConfidenceParse", "Low-confidence parse", "AI classification was low confidence", ["solutionType", "rootCause"]));

  return out;
}

/** Returns true when a flag's columnHint includes the given grid column key. */
function flagMatchesColumn(flag: AttentionFlag, key: string): boolean {
  if (!flag.columnHint) return false;
  if (typeof flag.columnHint === "string") return flag.columnHint === key;
  return flag.columnHint.includes(key);
}

/** Filters flags to only those that apply to a specific column. */
export function flagsForColumn(flags: AttentionFlag[], key: string): AttentionFlag[] {
  return flags.filter((f) => flagMatchesColumn(f, key));
}

export { tableForNumber };

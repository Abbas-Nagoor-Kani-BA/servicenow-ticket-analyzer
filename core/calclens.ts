/**
 * Calclens — pure per-cell derivation explainer.
 *
 * Turns a resolved viewer row + a grid column key into a human-readable
 * "how was this value derived" explanation for the Calclens inspector drawer.
 *
 * This module lives in core/ on purpose: it must not touch DOM, chrome.*,
 * IndexedDB or fetch. It reads only the ROW (the already-resolved data, which
 * includes the retained `activity` timeline events) and rule semantics — it
 * never re-parses the live audit feed.
 */

import { computeDurations } from "./durations.ts";
import type { DurationRow } from "./durations.ts";
import { buildReport, hmsToHours, responseTargetHours, resolutionTargetHours } from "./report.ts";
import type { Report } from "./report.ts";
import { snStateMap } from "./statechoices.ts";
import { classifyMsr } from "./msrcategorize.ts";
import { type MsrScore } from "./msrcategorize.ts";

export type ActivityEv = { f?: string; o?: string; n?: string; atEpoch?: number };

export type ExplanationKind = "raw" | "timeline" | "duration" | "report" | "classification";

/** Pairs of inputs the derivation read, shown in the drawer. */
export type ExplainInput = { label: string; value: string };

export type TimelineFieldIcon = "group" | "assignee" | "state";

/** One node on the drawer's visual timeline strip. */
export type TimelineStep = {
  /** UTC ISO timestamp of the event. */
  atIso: string;
  /** Instance-clock label for the event time (via fmtInstant). */
  atLabel: string;
  /** Which field the event belongs to — drives the Lucide icon. */
  fieldIcon: TimelineFieldIcon;
  from: string;
  to: string;
  /** True when this event is the one whose time the selected cell shows. */
  selected: boolean;
};

/** SLA "easy digest": a target-vs-actual comparison with a met/breached verdict. */
export type SlDigest = {
  targetLabel: string;
  target: string;
  actual: string;
  met: boolean | null;
  metLabel: string;
  line: string;
  /** The instance-clock source times the actual was computed from, e.g. Assigned/Ack/Resolved. */
  sourceTimes: ExplainInput[];
  /** Plain-language arithmetic that turned the source times into the actual, e.g. "Ack − Assigned". */
  op: string;
};

export type Explanation = {
  kind: ExplanationKind;
  /** Column label, e.g. "Assign time". */
  label: string;
  /** Value as shown in the cell. */
  value: string;
  /** One-line "what this is / where it came from". */
  summary: string;
  /** The transition that produced the value (old → new), when applicable. */
  transition?: string;
  /** SLA comparison (target vs actual) for SLA/report cells. */
  digest?: SlDigest;
  /** Visual timeline of the ticket's activity events, with the picked one selected. */
  timeline?: TimelineStep[];
  /** The concrete inputs the derivation read from the row. */
  inputs: ExplainInput[];
  /** Ordered, human-readable derivation steps. */
  steps: string[];
  /** Classification confidence, e.g. "87%". */
  confidence?: string;
  /** Caveats / edge cases the user should know about. */
  warnings: string[];
};

export type ExplainCtx = {
  /** The same instance-clock formatter the grid uses (it affects SLA results). */
  fmtInstant?: (utcIso: string, row: Record<string, any>) => string;
  /** MSR lists, for validating/highlighting classification values. */
  msrLists?: any;
};

const EMPTY = "—";

function str(v: unknown): string {
  return v === null || v === undefined || v === "" ? "" : String(v);
}

function dflt(v: unknown): string {
  return str(v) || EMPTY;
}

function tableForNumber(number: unknown): string {
  const s = String(number ?? "");
  if (s.startsWith("INC")) return "incident";
  if (s.startsWith("REQ")) return "sc_req_item";
  if (s.startsWith("PTASK")) return "problem";
  return "incident";
}

function stateLabel(table: string, raw: unknown): string {
  const v = String(raw ?? "");
  if (!v) return "";
  const map = snStateMap(table);
  return map[v] || map[v.toLowerCase()] || v;
}

function fmtOrRaw(ctx: ExplainCtx, row: Record<string, any>, iso: unknown): string {
  if (!iso) return "";
  if (ctx.fmtInstant) return ctx.fmtInstant(String(iso), row);
  return String(iso);
}

/** Instance-clock label for a raw UTC datetime ("yyyy-MM-dd HH:mm:ss") on the row. */
function fmtFullFromRow(ctx: ExplainCtx, row: Record<string, any>, iso: unknown): string {
  const s = str(iso);
  if (!s) return "";
  const withT = s.includes("T") ? s : s.replace(" ", "T");
  return fmtOrRaw(ctx, row, withT.endsWith("Z") || /[+-]\d\d:\d\d$/.test(withT) ? withT : withT + "Z");
}

/** Match a retained activity event to a resolved timestamp by field + epoch. */
function matchEvent(row: Record<string, any>, field: string, iso: unknown, table: string):
  { o: string; n: string; atEpoch: number } | null {
  if (!iso) return null;
  const target = Date.parse(String(iso).replace(" ", "T"));
  if (!Number.isFinite(target)) return null;
  const evs = Array.isArray(row.activity) ? (row.activity as ActivityEv[]) : [];
  for (const ev of evs) {
    if (ev.f !== field) continue;
    if (ev.atEpoch === target) {
      const o = field === "state" ? stateLabel(table, ev.o) : str(ev.o);
      const n = field === "state" ? stateLabel(table, ev.n) : str(ev.n);
      return { o, n, atEpoch: ev.atEpoch };
    }
  }
  return null;
}

function timelineInputs(ctx: ExplainCtx, row: Record<string, any>, field: string, iso: unknown, display: string): ExplainInput[] {
  return [
    { label: "Value", value: display },
    { label: "UTC timestamp", value: str(iso) || EMPTY }
  ];
}

function fieldIconOf(f: string): TimelineFieldIcon {
  if (f === "assignment_group") return "group";
  if (f === "assigned_to") return "assignee";
  return "state";
}

function eventLabel(table: string, f: string, v: unknown): string {
  return f === "state" ? stateLabel(table, v) : str(v);
}

/**
 * Build the full visual timeline of the ticket's activity events (newest-first
 * in the row, reversed here to chronological), with Lucide field icons and
 * instance-clock labels.
 */
function buildTimeline(ctx: ExplainCtx, row: Record<string, any>, table: string): TimelineStep[] {
  const evs = Array.isArray(row.activity) ? (row.activity as ActivityEv[]) : [];
  return [...evs]
    .filter((e) => e && Number.isFinite(e.atEpoch))
    .sort((a, b) => (a.atEpoch as number) - (b.atEpoch as number))
    .map((ev) => {
      const f = str(ev.f);
      const atIso = new Date(ev.atEpoch as number).toISOString();
      return {
        atIso,
        atLabel: fmtOrRaw(ctx, row, atIso),
        fieldIcon: fieldIconOf(f),
        from: eventLabel(table, f, ev.o),
        to: eventLabel(table, f, ev.n),
        selected: false
      };
    });
}

/** Mark the event for `field` whose epoch equals `iso` as selected. */
function selectTimelineEvent(timeline: TimelineStep[], field: string, iso: unknown): TimelineStep[] {
  const target = Date.parse(String(iso ?? "").replace(" ", "T"));
  if (!Number.isFinite(target)) return timeline;
  for (const step of timeline) {
    const evField = step.fieldIcon === "group" ? "assignment_group" : step.fieldIcon === "assignee" ? "assigned_to" : "state";
    if (evField === field && Date.parse(step.atIso) === target) {
      step.selected = true;
      break;
    }
  }
  return timeline;
}

function fmtHoursDecimal(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "0";
  return `${hours.toFixed(1)} h`;
}

function fmtPct(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) ? `${Math.round(v * 100)}%` : EMPTY;
}

/** Friendly label + the MSR list backing a choice column, when one exists. */
function picklistFor(colKey: string, row: Record<string, any>, ctx: ExplainCtx):
  { label: string; list: string[] } | null {
  const lists = ctx.msrLists as any;
  if (!lists || typeof lists !== "object") return null;
  if (colKey === "subCategory") {
    return Array.isArray(lists.subCategory) ? { label: "Sub-category", list: lists.subCategory.map(String) } : null;
  }
  if (colKey === "duplicateIncident") {
    return Array.isArray(lists.duplicate) ? { label: "Duplicate", list: lists.duplicate.map(String) } : null;
  }
  return null;
}

/** Business-hours branch phrasing shared by SLA/incident-duration explanations. */
function businessBranchNote(priority: unknown): string {
  const p = slaPriorityFor(priority);
  return p === 1 || p === 2
    ? "Priority 1/2 uses straight wall-clock elapsed time"
    : "Priority 3/4 uses work-hours (08:00–17:00, weekdays) minus the suspend window";
}

function explainRaw(row: Record<string, any>, key: string, value: string): Explanation {
  return {
    kind: "raw",
    label: key,
    value,
    summary: "Stored value — not computed by the analyzer.",
    inputs: [{ label: "Field", value: key }, { label: "Value", value: value || EMPTY }],
    steps: [
      `The \`${key}\` cell is copied straight from the ServiceNow record during the pull; ` +
      "the analyzer does not derive or change it (unless you edit it in the grid)."
    ],
    warnings: []
  };
}

function explainTimeline(
  ctx: ExplainCtx,
  row: Record<string, any>,
  key: string,
  iso: unknown,
  display: string,
  table: string
): Explanation {
  const field = { assignTimeUtcIso: "assignment_group", acknTimeUtcIso: "assigned_to" }[key] ?? "state";
  const ev = matchEvent(row, field, iso, table);

  const out: Explanation = {
    kind: "timeline",
    label: key,
    value: display,
    summary: "",
    inputs: timelineInputs(ctx, row, field, iso, display),
    steps: [],
    warnings: []
  };

  if (key === "assignTimeUtcIso") {
    out.summary = "The moment this ticket came into the selected queue.";
    const curGroup = str(row.assignmentGroup);
    const opened = fmtFullFromRow(ctx, row, row.openedAtRaw || row.openedAt);
    if (ev) {
      out.transition = `${dflt(ev.o)} \u2192 ${dflt(ev.n)}`;
      out.steps = [
        "This ticket has a history of queue changes we can look through.",
        `We look for the last time the queue changed TO **${dflt(curGroup)}** \u2014 that was **${dflt(display)}**.`,
        opened
          ? `That's after the ticket was opened (${opened}), so the assign time stays as **${dflt(display)}**.`
          : `So the assign time is **${dflt(display)}**.`
      ];
    } else {
      out.steps = [
        "This ticket has no record of its queue ever changing.",
        `Its current queue is **${dflt(curGroup)}**, which is the selected queue, so we treat it as having started here.`,
        `So the assign time is the ticket's opened time (**${opened || dflt(display)}**).`
      ];
      out.warnings.push("Ticket started in this queue, so assign time = opened time.");
    }
    if (opened) out.steps.push(`The assign time can't be before the ticket was opened (${opened}), so we keep it no earlier than that.`);
  } else if (key === "acknTimeUtcIso") {
    out.summary = "The moment a member of the team picked the ticket up.";
    const queueName = str(row.assignmentGroup);
    const assigneeName = ev ? str(ev.n || ev.o || "") : str(row.assignedTo);
    const person = assigneeName || "the assigned engineer";
    if (ev) {
      out.transition = `${dflt(ev.o)} \u2192 ${dflt(ev.n)}`;
      out.steps = [
        "We look through the ticket's assigned-to history to find when a team member took it.",
        `Only assignments to someone on the **${dflt(queueName)}** team (the list set in Settings) count.`,
        "Only assignments made AFTER the ticket entered the queue count.",
        `The first one that qualifies was to **${person}** at **${dflt(display)}** \u2014 that's the acknowledge time.`
      ];
    } else {
      out.steps = [
        "No team member was assigned to this ticket after it entered the queue, so there's nothing to count.",
        "The acknowledge time is therefore empty."
      ];
      out.warnings.push("Ackn needs a team member (Settings list) assigned after the ticket entered the queue.");
    }
  } else if (key === "suspendTimeUtcIso") {
    out.summary = "The first time this ticket went On Hold in the selected queue.";
    const queueName = str(row.assignmentGroup);
    if (ev) {
      out.transition = `${dflt(ev.o)} \u2192 ${dflt(ev.n)}`;
      out.steps = [
        "We look through the ticket's status history.",
        `The first time the status moved INTO "On Hold" was at **${dflt(display)}**.`,
        `It only counts because the ticket was in the **${dflt(queueName)}** queue at that moment \u2014 going On Hold in another queue is ignored.`,
        `In all, this ticket went On Hold **${Number(row.onHoldCount) || 0}** time${Number(row.onHoldCount) === 1 ? "" : "s"}.`
      ];
    } else {
      out.steps = ["No move into \"On Hold\" happened at this time, so suspend is empty."];
    }
  } else if (key === "resumeTimeUtcIso") {
    out.summary = "The first time the ticket came back from being On Hold.";
    const src = str(row.resumeSource);
    if (ev) {
      out.transition = `${dflt(ev.o)} \u2192 ${dflt(ev.n)}`;
      out.steps = [
        "After it went On Hold, we look for the next time the status moved back to active work.",
        `That was at **${dflt(display)}**, when the status changed from **${dflt(ev.o)}** to **${dflt(ev.n)}** \u2014 this is the resume time.`,
        src === "Resolved"
          ? "It came back as **Resolved** (used because the ticket went straight to Resolved after the hold)."
          : src === "In Progress"
            ? "It came back as **In Progress**."
            : ""
      ].filter(Boolean);
    } else {
      out.steps = [
        "The ticket never moved back to In Progress or Resolved after its first hold, so resume is empty."
      ];
    }
  }

  out.inputs.push({
    label: "Rule output",
    value: `resume status: ${dflt(srcFor(key, row)) || "none"}, times On Hold: ${dflt(row.onHoldCount)}`
  });
  out.timeline = selectTimelineEvent(buildTimeline(ctx, row, table), field, iso);
  return out;
}

function srcFor(key: string, row: Record<string, any>): string {
  if (key !== "resumeTimeUtcIso") return "";
  return str(row.resumeSource);
}

function explainDuration(
  row: Record<string, any>,
  ctx: ExplainCtx,
  key: string,
  durations: Record<string, string>
): Explanation {
  const value = durations[key.slice(4)] ?? "";
  const durLabel = key.slice(4);
  const queueName = str(row.assignmentGroup);
  const assigneeName = str(row.assignedTo);
  const person = assigneeName || "the assigned engineer";
  let left = "", right = "", leftLabel = "", rightLabel = "", summary = "";
  let clockLeft = "", clockRight = "";
  if (durLabel === "assignToAckn") {
    leftLabel = "Ackn time"; left = str(row.acknTimeUtcIso);
    rightLabel = "Assign time"; right = str(row.assignTimeUtcIso);
    clockRight = fmtOrRaw(ctx, row, right);
    clockLeft = fmtOrRaw(ctx, row, left);
    summary = "How long from when the ticket reached this team until it was picked up.";
  } else if (durLabel === "assignToResolve") {
    leftLabel = "Resolved"; left = str(row.resolvedAtRaw ?? row.resolvedAt);
    rightLabel = "Assign time"; right = str(row.assignTimeUtcIso);
    clockRight = fmtOrRaw(ctx, row, right);
    clockLeft = fmtOrRaw(ctx, row, left);
    summary = "The total time from assignment to resolution.";
  } else {
    leftLabel = "Resume"; left = str(row.resumeTimeUtcIso);
    rightLabel = "Suspend"; right = str(row.suspendTimeUtcIso);
    clockRight = fmtOrRaw(ctx, row, right);
    clockLeft = fmtOrRaw(ctx, row, left);
    summary = "How long the ticket stayed On Hold.";
  }

  const decimal = hmsToDecimalHours(value);
  const bizNote = businessBranchNote(row.priority);

  const out: Explanation = {
    kind: "duration",
    label: key,
    value: value || EMPTY,
    summary,
    inputs: [
      { label: leftLabel, value: dflt(clockLeft) },
      { label: rightLabel, value: dflt(clockRight) },
      { label: "Format", value: "H:MM:SS (business duration)" }
    ],
    steps: [],
    warnings: []
  };

  if (value) {
    if (durLabel === "assignToAckn") {
      out.steps.push(`The ticket reached the **${dflt(queueName)}** queue at **${dflt(clockRight)}**.`);
      out.steps.push(`It was picked up by **${person}** at **${dflt(clockLeft)}**.`);
      out.steps.push(`That's about **${value}**${decimal ? ` (${fmtHoursDecimal(decimal)})` : ""} of wait time.`);
      out.steps.push(`How it's measured: ${bizNote}.`);
    } else if (durLabel === "assignToResolve") {
      out.steps.push(`The ticket was assigned at **${dflt(clockRight)}** and resolved at **${dflt(clockLeft)}**.`);
      out.steps.push(`That's about **${value}**${decimal ? ` (${fmtHoursDecimal(decimal)})` : ""} in total.`);
      out.steps.push(`How it's measured: ${bizNote}.`);
    } else {
      out.steps.push(`This ticket went On Hold at **${dflt(clockRight)}** and came back at **${dflt(clockLeft)}**.`);
      out.steps.push(`That's a held window of about **${value}**${decimal ? ` (${fmtHoursDecimal(decimal)})` : ""}.`);
      out.steps.push("Only the first On Hold \u2192 first resume window is counted here; a ticket held more than once shows less time on purpose.");
    }
  } else {
    out.steps.push("There isn't enough to work out this duration \u2014 an endpoint is missing, happened in the wrong order, or is zero.");
    out.warnings.push("Empty duration = missing/inverted/zero endpoint pair.");
  }
  return out;
}

function hmsToDecimalHours(hms: string | undefined | null): number {
  if (!hms) return NaN;
  const m = String(hms).match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return NaN;
  return parseInt(m[1]) + parseInt(m[2]) / 60 + (parseInt(m[3] || "0")) / 3600;
}

function responseDigest(row: Record<string, any>, rep: Report): SlDigest | undefined {
  const p = slaPriorityFor(row.priority);
  const targetH = responseTargetHours(p);
  const actualH = hmsToHours(rep.responseSLA);
  if (!targetH) return undefined;
  const met = rep.metResponseSLA === "YES" ? true : rep.metResponseSLA === "No" ? false : null;
  const metLabel = met === null ? "unknown" : met ? "Met" : "Breached";
  const sourceTimes: ExplainInput[] = [
    { label: "Assigned", value: rep.assigned || EMPTY },
    { label: "Ack", value: rep.ackn || EMPTY }
  ];
  const op = p === 1 || p === 2
    ? "Ack \u2212 Assigned (straight elapsed)"
    : "Ack \u2212 Assigned (business hours, minus suspend window)";
  return {
    targetLabel: "Response target",
    target: `${fmtHoursDecimal(targetH)} (P${p})`,
    actual: rep.responseSLA ? `${rep.responseSLA} (${fmtHoursDecimal(actualH)})` : EMPTY,
    met,
    metLabel,
    sourceTimes,
    op,
    line: met === null
      ? `Response target ${fmtHoursDecimal(targetH)} (P${p}); actual ${rep.responseSLA || "—"}.`
      : met
        ? `Acknowledged within the ${fmtHoursDecimal(targetH)} target (P${p}) → Met.`
        : `Acknowledged in ${rep.responseSLA} against a ${fmtHoursDecimal(targetH)} target (P${p}) → Breached.`
  };
}

function resolutionDigest(row: Record<string, any>, rep: Report): SlDigest | undefined {
  const p = slaPriorityFor(row.priority);
  const t = resolutionTargetHours(p);
  if (!t.min && !t.max) return undefined;
  const actualH = hmsToHours(rep.incCurrentHours);
  const met = rep.metMaxResolutionSLA === "NO" ? false : rep.metMinResolutionSLA === "YES" ? true : null;
  const metLabel = met === null ? "unknown" : met ? "Met" : "Breached";
  const sourceTimes: ExplainInput[] = [
    { label: "Assigned", value: rep.assigned || EMPTY },
    { label: rep.resolved ? "Resolved" : "Now", value: rep.resolved || EMPTY }
  ];
  const op = p === 1 || p === 2
    ? "Resolved \u2212 Assigned (straight elapsed)"
    : "Resolved \u2212 Assigned (business hours, minus suspend window)";
  return {
    targetLabel: "Resolution target",
    target: `${fmtHoursDecimal(t.min)}–${fmtHoursDecimal(t.max)} (P${p})`,
    actual: rep.incCurrentHours ? `${rep.incCurrentHours} (${fmtHoursDecimal(actualH)})` : EMPTY,
    met,
    metLabel,
    sourceTimes,
    op,
    line: met === null
      ? `Resolution target ${fmtHoursDecimal(t.min)}–${fmtHoursDecimal(t.max)} (P${p}); current ${rep.incCurrentHours || "—"}.`
      : met
        ? `Resolved within the ${fmtHoursDecimal(t.max)} max target (P${p}) → Met.`
        : `At ${rep.incCurrentHours} current hours, past the ${fmtHoursDecimal(t.max)} max target (P${p}) → Breached.`
  };
}

function slaPriorityFor(priority: unknown): number {
  let n = parseInt(String(priority));
  if (!Number.isFinite(n)) return 0;
  if (n > 4) n = 4;
  return n > 0 ? n : 0;
}

function explainReport(
  row: Record<string, any>,
  key: string,
  rep: Report
): Explanation {
  const field = key.slice(4);
  const value = String((rep as Record<string, any>)[field] ?? "");

  const queueName = str(row.assignmentGroup);
  const assigneeName = str(row.assignedTo);
  const person = assigneeName || "the assigned engineer";

  const out: Explanation = {
    kind: "report",
    label: key,
    value: value || EMPTY,
    summary: "A value the report worked out from this ticket's details.",
    inputs: [
      { label: "Number", value: dflt(row.number) },
      { label: "Priority", value: dflt(row.priority) },
      { label: "State", value: dflt(row.state) }
    ],
    steps: [],
    warnings: []
  };

  if (field === "type") {
    out.summary = "What kind of ticket this is.";
    out.steps = [`The number starts with **\`${dflt(row.number).slice(0, 3)}\`**, which tells us this is an **\`${value}\`** ticket.`];
  } else if (field === "metResponseSLA" || field === "responseSLA") {
    out.summary = "Whether this ticket was picked up quickly enough.";
    out.digest = responseDigest(row, rep);
    const respH = rep.respHours;
    const tgt = rep.respTarget;
    out.steps = [
      `The ticket reached **${dflt(queueName)}** and was picked up by **${person}** at **${dflt(rep.acknClock || rep.ackn)}**.`,
      `That's about **${respH != null ? fmtHoursDecimal(respH) : dflt(rep.responseSLA)}**${respH != null ? ` (\`${dflt(rep.responseSLA)}\`)` : ""} of wait time.`,
      tgt != null
        ? `For a priority-${dflt(row.priority)} ticket the target is **${fmtHoursDecimal(tgt)}**, so this one ${respH != null
            ? (respH < tgt ? "made it in time (**Met**)." : "ran past the target (**Breached**).")
            : `reads as \`${dflt(rep.metResponseSLA)}\`.`}`
        : `It's checked against the priority-${dflt(row.priority)} response target.`
    ];
    if (field === "metResponseSLA") out.steps.push(`The reported answer is \`${dflt(rep.metResponseSLA)}\`.`);
    if (value === "No") out.warnings.push("Response SLA was missed \u2014 this adds an 'R' to the SLA-breach marker.");
  } else if (field === "metMinResolutionSLA" || field === "metMaxResolutionSLA") {
    out.summary = "Whether the ticket was resolved inside its target window.";
    out.digest = resolutionDigest(row, rep);
    const cur = rep.incCurrentRaw;
    const lo = rep.resMinTarget;
    const hi = rep.resMaxTarget;
    out.steps = [
      `This ticket took about **${cur != null ? fmtHoursDecimal(cur) : dflt(rep.incCurrentHours)}**${cur != null ? ` (\`${dflt(rep.incCurrentHours)}\`)` : ""} from assignment to ${rep.resolved ? "resolution" : "now"}.`,
      (lo != null && hi != null)
        ? `For a priority-${dflt(row.priority)} ticket the target window is **${fmtHoursDecimal(lo)} \u2013 ${fmtHoursDecimal(hi)}**.`
        : `It's checked against the priority-${dflt(row.priority)} resolution window.`,
      field === "metMinResolutionSLA"
        ? `Against the lower bound that reads \`${dflt(rep.metMinResolutionSLA)}\`.`
        : (cur != null && hi != null
            ? (cur < hi ? `It finished inside the window, so it's **met** (\`${dflt(rep.metMaxResolutionSLA)}\`).` : `It ran past the window, so it's **missed** (\`${dflt(rep.metMaxResolutionSLA)}\`).`)
            : `Against the upper bound that reads \`${dflt(rep.metMaxResolutionSLA)}\`.`)
    ];
    if (field === "metMaxResolutionSLA" && value === "NO") {
      out.warnings.push("The resolution window was missed \u2014 this adds an 'M' to the SLA-breach marker.");
    }
  } else if (field === "incidentHours") {
    out.summary = "How long the ticket was open, from Created to Resolved.";
    out.digest = resolutionDigest(row, rep);
    out.steps = [
      `It was created at **${dflt(rep.createdClock || rep.created)}** and resolved at **${dflt(rep.resolvedClock || rep.resolved)}**.`,
      `That's about **${rep.incHoursRaw != null ? fmtHoursDecimal(rep.incHoursRaw) : dflt(rep.incidentHours)}**${rep.incHoursRaw != null ? ` (\`${dflt(rep.incidentHours)}\`)` : ""} in total.`,
      `It's measured as: ${businessBranchNote(row.priority)}.`
    ];
  } else if (field === "incidentTotalAge") {
    out.summary = "How many working days the ticket was open.";
    out.digest = resolutionDigest(row, rep);
    out.steps = [
      `The ticket was open for about **${rep.incHoursRaw != null ? fmtHoursDecimal(rep.incHoursRaw) : dflt(rep.incidentHours)}** (${dflt(rep.incidentHours)}).`,
      `Counting **9 working hours per day**, that works out to about **\`${value || EMPTY}\` business days**.`
    ];
  } else if (field === "incCurrentHours") {
    out.summary = "How far along the ticket is, from assignment to resolution or now.";
    out.digest = resolutionDigest(row, rep);
    out.steps = [
      `Counted from **Assigned** (\`${dflt(rep.assignedClock || rep.assigned)}\`) to **${rep.resolved ? "Resolved" : "now"}** (\`${dflt(rep.resolvedClock || rep.resolved || "now")}\`).`,
      `That's about **${rep.incCurrentRaw != null ? fmtHoursDecimal(rep.incCurrentRaw) : dflt(rep.incCurrentHours)}**${rep.incCurrentRaw != null ? ` (\`${dflt(rep.incCurrentHours)}\`)` : ""}.`,
      "This starts at assignment, not creation \u2014 slightly different from the full incident hours."
    ];
  } else if (field === "incidentCurrentAge") {
    out.summary = "How many working days since the ticket was assigned.";
    out.digest = resolutionDigest(row, rep);
    out.steps = [
      `From assignment, the ticket has run about **${rep.incCurrentRaw != null ? fmtHoursDecimal(rep.incCurrentRaw) : dflt(rep.incCurrentHours)}** (${dflt(rep.incCurrentHours)}).`,
      `Counting **9 working hours per day**, that's about **\`${value || EMPTY}\` business days**.`
    ];
  } else if (field === "cumulativeSla" || field === "cumulativeDays") {
    out.summary = "The ticket's totals across its whole lifetime.";
    const cumMet = rep.metMaxResolutionSLA === "NO" ? false : rep.metMinResolutionSLA === "YES" ? true : null;
    out.digest = {
      targetLabel: "Cumulative (lifetime)",
      target: rep.cumulativeSla ? `${dflt(rep.cumulativeSla)}` : EMPTY,
      actual: rep.cumulativeDays ? `${dflt(rep.cumulativeDays)} d` : EMPTY,
      met: cumMet,
      metLabel: cumMet === null ? "unknown" : cumMet ? "Met" : "Breached",
      sourceTimes: [
        { label: "Cumulative SLA", value: dflt(rep.cumulativeSla) },
        { label: "Cumulative days", value: dflt(rep.cumulativeDays) }
      ],
      op: "Lifetime total across all reopens/resolutions",
      line: `Cumulative SLA \`${dflt(rep.cumulativeSla)}\`, cumulative days \`${dflt(rep.cumulativeDays)}\`.`
    };
    out.steps = [
      `Over its whole life, this ticket logged **\`${dflt(rep.cumulativeSla)}\`** of SLA time and **\`${dflt(rep.cumulativeDays)}\`** of days.`,
      "That adds up every resolution window the ticket had, not just the first one."
    ];
  } else if (field === "resolutionType" || field === "rootCauseCategory") {
    out.summary = "The category copied into the report.";
    out.steps = [
      `Solution type: \`${dflt(rep.resolutionType)}\`. Root cause: \`${dflt(rep.rootCauseCategory)}\`.`
    ];
  } else if (field === "analysedDate") {
    out.summary = "When the analysis for this ticket ran.";
    out.steps = [`The report ran on **\`${dflt(rep.analysedDate)}\`**.`, "This is just the timestamp of the analysis."];
  } else {
    out.summary = "A value the report worked out from this ticket's details.";
    out.steps = [`The value is \`${value || EMPTY}\`.`];
  }

  return out;
}

/** Explains a picklist-backed choice column (subCategory, duplicateIncident). */
function explainMsrChoice(
  row: Record<string, any>,
  colKey: string,
  ctx: ExplainCtx
): Explanation {
  const pick = picklistFor(colKey, row, ctx);
  const value = str(row[colKey]);
  const isMember = pick ? inList(pick.list, value) : false;

  const out: Explanation = {
    kind: "raw",
    label: colKey,
    value: value || EMPTY,
    summary: "MSR choice — a picklist value, not free text or a derived number.",
    inputs: [
      { label: "Value", value: value || EMPTY },
      ...(pick ? [{ label: `${pick.label} options`, value: `${pick.list.length}` }] : [])
    ],
    steps: [],
    warnings: []
  };

  if (pick) {
    out.steps = [
      `**${dflt(value)}** must be an **exact member** of the ${pick.label} picklist (**${pick.list.length} options**).`,
      isMember
        ? `It **is** a valid exact member of the ${pick.label} list, so it was kept as-is.`
        : `It is **not** in the ${pick.label} list (off-list) — check the value or the picklist in Settings.`
    ];
  } else {
    out.steps = ["This is a picklist value read from the row; the option list was not available."];
  }
  if (value && !isMember) out.warnings.push(`Value is not in the active ${pick ? pick.label : ""} picklist (off-list).`.trim());

  return out;
}

function explainClassification(
  row: Record<string, any>,
  key: string,
  ctx: ExplainCtx
): Explanation {
  const field = key === "rootCause" ? "rootCause" : "solutionType";
  const value = str(row[key]);
  const notes = str(row.closeNotes);
  const labelName = field === "rootCause" ? "root cause" : "solution type";

  const lists = field === "rootCause"
    ? (buildRootCauseList(row, ctx))
    : (buildResolutionList(row, ctx));

  const source = field === "rootCause" ? str(row.__rcSource) : str(row.__solSource);
  const conf = Number(field === "rootCause" ? row.__rcConf : row.__solConf);
  const inChoice = value && inList(lists, value);

  // Keyword side is always re-scored so the drawer can show both engines.
  let reclass: MsrScore | null = null;
  if (notes && lists.length) {
    try { reclass = classifyMsr(notes, lists); } catch { reclass = null; }
  }
  const kwLabel = reclass?.label || null;
  const kwConf = reclass?.confidence || 0;
  const kwScore = kwLabel ? (reclass?.scores[kwLabel] || 0) : 0;

  const out: Explanation = {
    kind: "classification",
    label: key,
    value: value || EMPTY,
    summary: `How the closing note was turned into a ${labelName}.`,
    inputs: [
      { label: "Value", value: value || EMPTY },
      { label: "Source", value: source ? source.toUpperCase() : "unrecorded" },
      { label: "Confidence", value: Number.isFinite(conf) && conf > 0 ? fmtPct(conf) : EMPTY },
      { label: "Notes length", value: `${notes.length} chars` }
    ],
    steps: [],
    warnings: []
  };

  if (source === "ml") {
    out.confidence = fmtPct(conf);
    out.steps = [
      `The closing note was checked two ways: by the machine-learning model and by keyword matching.`,
      `The model matched **${dflt(value)}** with **${fmtPct(conf)}** confidence.`,
      kwLabel
        ? `Keyword matching found **\`${kwLabel}\`** (${kwScore} matching hint${kwScore === 1 ? "" : "s"}, confidence **${fmtPct(kwConf)}**) \u2014 no stronger answer.`
        : "Keyword matching found no stronger answer.",
      `So we go with the model's pick: **${dflt(value)}**.`,
      notes ? `From the note: \`${truncate(notes, 80)}\`.` : ""
    ].filter(Boolean);
    if (Number.isFinite(conf) && conf < 0.5) {
      out.warnings.push(`The model's confidence here is low (${fmtPct(conf)}) \u2014 you may want to double-check this ${labelName}.`);
    }
  } else if (source === "heuristic") {
    out.confidence = fmtPct(kwConf || conf);
    out.steps = [
      `The closing note was checked two ways: by the machine-learning model and by keyword matching.`,
      kwLabel && kwLabel !== value
        ? `Keyword matching found **\`${value}\`** from **${kwScore} hint${kwScore === 1 ? "" : "s"}** with **${fmtPct(kwConf)}** confidence, and that beat the model's \`${kwLabel}\`.`
        : `Keyword matching found **\`${dflt(value)}\`** from **${kwScore} hint${kwScore === 1 ? "" : "s"}** with **${fmtPct(kwConf)}** confidence.`,
      kwLabel && kwLabel !== value
        ? `The model suggested **\`${kwLabel}\`** (${fmtPct(conf)}), but the keyword result is used here.`
        : conf > 0
          ? `The model also read it as **\`${dflt(value)}\`** at ${fmtPct(conf)}, agreeing with the keyword match.`
          : "The model came back empty, so the keyword result is used.",
      notes ? `From the note: \`${truncate(notes, 80)}\`.` : ""
    ].filter(Boolean);
  } else {
    if (value) {
      out.steps = [
        `**${dflt(value)}** was already on the row \u2014 typed, pasted, or from an earlier run.`,
        "No classification was re-run for this cell.",
        notes ? `From the note: \`${truncate(notes, 80)}\`.` : ""
      ].filter(Boolean);
      if (inChoice) out.steps.push("Re-classify to refresh or verify it against the current model.");
    } else {
      out.steps = ["No category here yet \u2014 the note didn't produce a confident match, or none was applied."];
      if (notes) out.warnings.push("The ticket has notes but no category \u2014 confidence was below the bar or nothing matched.");
    }
  }

  if (row.parseReview) out.warnings.push("The parse was low-confidence \u2014 flagged for review.");
  if (value && !inChoice) out.warnings.push("This value isn't in the active option list (off-list).");

  return out;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}\u2026` : s;
}

function buildRootCauseList(row: Record<string, any>, ctx: ExplainCtx): string[] {
  return listFor(row, "rootCause", ctx);
}
function buildResolutionList(row: Record<string, any>, ctx: ExplainCtx): string[] {
  return listFor(row, "resolution", ctx);
}
function listFor(row: Record<string, any>, kind: "rootCause" | "resolution", ctx: ExplainCtx): string[] {
  const lists = ctx.msrLists;
  if (lists && typeof lists === "object") {
    if (kind === "resolution") {
      const r = (lists as any).resolution;
      if (Array.isArray(r) && r.length) return r.map(String);
    } else {
      const rc = (lists as any).rootCause;
      if (rc && typeof rc === "object") {
        const n = String(row.number ?? "");
        const bucket = n.startsWith("REQ") ? "RFS" : n.startsWith("PTASK") ? "P_Ticket" : "Incident";
        const arr = (rc as any)[bucket];
        if (Array.isArray(arr) && arr.length) return arr.map(String);
      }
    }
  }
  if (kind === "resolution") {
    return ["Workaround solution", "Permanent solution", "Verification only", "Not applicable"];
  }
  const n = String(row.number ?? "");
  if (n.startsWith("REQ")) return RFS_RC;
  if (n.startsWith("PTASK")) return PTASK_RC;
  return INC_RC;
}

const INC_RC = [
  "Application bug", "Application performance", "Database performance",
  "Server performance", "Hardware", "Environment", "Interface data error",
  "Interfacing application error", "Network issue", "Firewall", "Certificate expiry",
  "User error - procedure", "False alert", "User query", "Information request",
  "User access issue", "Password reset", "Job schedule/scheduler error",
  "External-3rd party", "Duplicate incident", "Not an issue", "Invalid issue",
  "Dependent Application Failure", "Configuration Issue"
];
const RFS_RC = [] as string[];
const PTASK_RC = [
  "Application bug", "Application performance", "Database performance",
  "Server performance", "Hardware", "Environment", "Interface data error",
  "Interfacing application error", "Network issue", "Firewall", "Certificate expiry",
  "User error - data"
];

function inList(list: string[], value: string): boolean {
  return list.some((o) => o.toLowerCase() === value.toLowerCase());
}

/**
 * Explain how the current value of a grid column was derived for a row.
 *
 * @param row the resolved viewer row
 * @param colKey the grid column key (raw key, e.g. "rootCause", "rep:responseSLA", "dur:assignToAckn")
 * @param ctx formatter + optional MSR lists
 * @returns an Explanation, or null for unknown columns
 */
export function explainCell(
  row: Record<string, any>,
  colKey: string,
  ctx: ExplainCtx = {}
): Explanation | null {
  if (!row || typeof row !== "object") return null;

  // MSR picklist choice columns (validated exact members of an option list).
  if (colKey === "subCategory" || colKey === "duplicateIncident") {
    return explainMsrChoice(row, colKey, ctx);
  }

  // Raw stored columns.
  const rawKeys = new Set([
    "number", "shortDescription", "assignedTo", "priority", "state",
    "assignmentGroup", "configItem", "incidentState", "createdOn",
    "resolvedAt"
  ]);
  if (rawKeys.has(colKey)) {
    return explainRaw(row, colKey, str(row[colKey]));
  }

  // Timeline instants.
  if (colKey.endsWith("TimeUtcIso")) {
    const iso = row[colKey];
    const display = fmtOrRaw(ctx, row, iso);
    return explainTimeline(ctx, row, colKey, iso, display, tableForNumber(row.number));
  }

  // Durations.
  if (colKey.startsWith("dur:")) {
    let dur: Record<string, string>;
    try { dur = computeDurations(row as DurationRow); } catch { dur = {} as Record<string, string>; }
    return explainDuration(row, ctx, colKey, dur);
  }

  // Report columns.
  if (colKey.startsWith("rep:")) {
    let rep: Report;
    try {
      rep = buildReport(row as Parameters<typeof buildReport>[0], (ctx.fmtInstant as any) ?? null) as Report;
    } catch {
      return null;
    }
    return explainReport(row, colKey, rep);
  }

  // Classification values.
  if (colKey === "solutionType" || colKey === "rootCause") {
    return explainClassification(row, colKey, ctx);
  }

  return null;
}

export { tableForNumber };

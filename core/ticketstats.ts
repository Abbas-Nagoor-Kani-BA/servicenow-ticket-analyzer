import { buildReport } from "./report.ts";

type Row = Record<string, unknown>;
type Fmt = (utcIso: string, row: Row) => string;

export type SlaTally = { met: number; breached: number };

export type StateCount = { state: string; count: number };

export type TypeGroup = {
  /** Ticket type label from buildReport (Incident, RFS, Problem Record, ...). */
  type: string;
  /** Total tickets of this type. */
  count: number;
  /** Per-state counts within this type, descending count then name. */
  states: StateCount[];
};

export type TicketStats = {
  /** Ticket types, each with its per-state counts. Descending count then name. */
  types: TypeGroup[];
  /** Total tickets counted. */
  total: number;
  /** Number of closed/resolved tickets that carry SLA verdicts. */
  closedTotal: number;
  /** Met/breached tallies over closed tickets, per SLA. */
  response: SlaTally;
  minResolution: SlaTally;
  maxResolution: SlaTally;
};

function isClosedState(label: string): boolean {
  const s = label.trim().toLowerCase();
  return s.startsWith("close") || s.startsWith("resolv") || s.startsWith("complete");
}

function tally(t: SlaTally, verdict: string): void {
  const v = verdict.trim().toUpperCase();
  if (v === "YES") t.met++;
  else if (v === "NO") t.breached++;
}

/**
 * Ticket analysis over the CURRENT view rows (pure).
 *
 * Groups rows by ticket TYPE, and within each type by readable state label,
 * counting them. SLA met/breached tallies (Response / Min Resolution / Max
 * Resolution) are accumulated only for closed/resolved tickets, because SLA
 * verdicts exist only once a ticket is terminal (the same rule buildReport uses
 * to populate the met fields).
 */
export function buildTicketStats(rows: Row[] | null | undefined, fmt?: Fmt | null): TicketStats {
  // type -> (state -> count)
  const byType = new Map<string, Map<string, number>>();
  const typeTotals = new Map<string, number>();
  const response: SlaTally = { met: 0, breached: 0 };
  const minResolution: SlaTally = { met: 0, breached: 0 };
  const maxResolution: SlaTally = { met: 0, breached: 0 };
  let total = 0;
  let closedTotal = 0;

  for (const row of rows || []) {
    const rep = buildReport(row as Parameters<typeof buildReport>[0], fmt as Parameters<typeof buildReport>[1]) as Record<string, unknown>;
    const typeLabel = String(rep.type ?? "").trim() || "Other";
    const stateLabel = String((row as Row).state ?? rep.state ?? "").trim() || "(no state)";

    if (!byType.has(typeLabel)) byType.set(typeLabel, new Map());
    const states = byType.get(typeLabel)!;
    states.set(stateLabel, (states.get(stateLabel) || 0) + 1);
    typeTotals.set(typeLabel, (typeTotals.get(typeLabel) || 0) + 1);
    total++;

    if (isClosedState(stateLabel)) {
      closedTotal++;
      tally(response, String(rep.metResponseSLA ?? ""));
      tally(minResolution, String(rep.metMinResolutionSLA ?? ""));
      tally(maxResolution, String(rep.metMaxResolutionSLA ?? ""));
    }
  }

  const types: TypeGroup[] = [...byType.entries()]
    .map(([type, stateMap]) => ({
      type,
      count: typeTotals.get(type) || 0,
      states: [...stateMap.entries()]
        .map(([state, count]) => ({ state, count }))
        .sort((a, b) => b.count - a.count || a.state.localeCompare(b.state))
    }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

  return { types, total, closedTotal, response, minResolution, maxResolution };
}

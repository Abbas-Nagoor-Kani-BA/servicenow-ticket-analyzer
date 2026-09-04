import { weekRanges } from "./summarydetails.ts";
import type { FilterSet } from "../data/repositories/filter-list-repository.ts";

type PresetSpec = {
  table: string;
  stateField: string;
  stateValue: string;
  closed: boolean;
};

const WSR_PRESETS: PresetSpec[] = [
  { table: "incident", stateField: "state", stateValue: "7", closed: true },
  { table: "incident", stateField: "state", stateValue: "3", closed: false },
  { table: "incident", stateField: "state", stateValue: "2", closed: false },
  { table: "sc_task", stateField: "state", stateValue: "3", closed: true },
  { table: "sc_task", stateField: "state", stateValue: "2", closed: false },
  { table: "problem", stateField: "problem_state", stateValue: "103", closed: false },
  { table: "problem", stateField: "problem_state", stateValue: "104", closed: false }
];

type Condition = { join: "AND" | "OR"; field: string; oper: string; value: string; value2: string };

/**
 * Weekly Status Report filter preset: one filter set per (table, state).
 * Closed states are scoped to last week (Monday-Sunday) by closed_at; open
 * states carry no date filter (current tickets in the queues). Last-week dates
 * are taken from weekRanges().last so this agrees with the WSR export.
 */
export function buildWsrFilterSets(now: Date = new Date()): FilterSet[] {
  const last = weekRanges(now).last;
  return WSR_PRESETS.map((p) => {
    const conditions: Condition[] = [
      { join: "AND", field: p.stateField, oper: "eq", value: p.stateValue, value2: "" }
    ];
    if (p.closed) {
      conditions.push({ join: "AND", field: "closed_at", oper: "between", value: last.from, value2: last.to });
    }
    // Only pull tickets with no parent incident (empty by default).
    conditions.push({ join: "AND", field: "parent_incident", oper: "isEmpty", value: "", value2: "" });
    return { table: p.table, conditions };
  });
}

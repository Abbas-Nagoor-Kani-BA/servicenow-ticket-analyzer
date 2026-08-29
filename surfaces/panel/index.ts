import { Container } from "../../di/container.ts";
import { registerCoreRepositories } from "../../di/register-core.ts";
import { FILTER_LIST_REPO, SETTINGS_REPO } from "../../di/tokens.ts";

import { LogCard } from "../../components/log-card.ts";
import { ProgressCard } from "../../components/progress-card.ts";
import { ConditionBuilder } from "../../components/condition-builder.ts";
import { FilterSetList, migrateLegacyFilterSets } from "../../components/filter-set-list.ts";
import type { CondFieldDef } from "../../components/condition-builder.ts";
import type { FilterSet } from "../../data/repositories/filter-list-repository.ts";

import { snStateChoices, SN_PRIORITY_CHOICES, snTableLabel } from "../../lib/statechoices.js";

/*
 * Composition root for the side panel.
 *
 * The only place that knows both the concrete repositories and the components
 * that use them. Components receive services and repositories through `deps`
 * and never construct anything themselves.
 */

export type PanelWiring = {
  container: Container;
  logCard: LogCard;
  progressCard: ProgressCard;
  conditions: ConditionBuilder;
  filterSets: FilterSetList;
  /** Resolves once persisted filter sets have been loaded. */
  ready: Promise<void>;
};

export function createPanel(options: {
  condFields: CondFieldDef[];
  choiceList: (key: string) => { value: string | number; label: string }[];
  onConditionChange: () => void;
  onFilterSetChange: () => void;
}): PanelWiring {
  // registerCoreRepositories installs the chrome.storage-backed store itself.
  const container = registerCoreRepositories(new Container());

  const $ = (id: string): HTMLElement => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`panel: missing #${id}`);
    return node;
  };

  const logCard = new LogCard($("logCard"), { modal: $("logModal") });
  const progressCard = new ProgressCard($("progressWrap"));

  const conditions = new ConditionBuilder(
    $("condRows"),
    { on: { change: options.onConditionChange } },
    {
      fields: options.condFields,
      choiceList: options.choiceList,
      tableLabel: snTableLabel,
      addButton: $("addCondBtn")
    }
  );

  const filterSets = new FilterSetList(
    $("filterListBox"),
    { on: { change: options.onFilterSetChange } },
    {
      repository: container.resolve(FILTER_LIST_REPO),
      card: $("filterListCard"),
      addButton: $("addFilterBtn"),
      describe: (set) => describeFilterSet(set, options.condFields, options.choiceList),
      keyOf: filterKey
    }
  );

  const ready = (async () => {
    await migrateLegacyFilterSets(container.resolve(FILTER_LIST_REPO));
    await filterSets.load();
  })();

  return { container, logCard, progressCard, conditions, filterSets, ready };
}

export function filterKey(set: FilterSet): string {
  return JSON.stringify([set.table, set.conditions]);
}

const COND_OP_LABELS: Record<string, string> = {
  isEmpty: "is empty",
  isNotEmpty: "is not empty",
  eq: "is",
  neq: "is not",
  contains: "contains",
  notContains: "doesn't contain",
  startsWith: "starts with",
  before: "before",
  after: "after",
  between: "between"
};

export function describeFilterSet(
  set: FilterSet,
  condFields: CondFieldDef[],
  choiceList: (key: string) => { value: string | number; label: string }[]
): string {
  const bits = [snTableLabel(set.table)];
  const summary = conditionsSummary(set.conditions, condFields, choiceList);
  if (summary) bits.push(summary);
  return bits.join(" \xB7 ");
}

function conditionsSummary(
  conds: unknown,
  condFields: CondFieldDef[],
  choiceList: (key: string) => { value: string | number; label: string }[]
): string {
  let out = "";
  (Array.isArray(conds) ? conds : []).forEach((raw, i) => {
    const c = raw as { join?: string; field?: string; oper?: string; value?: unknown; value2?: unknown };
    if (i > 0) out += c.join === "OR" ? " OR " : " AND ";
    out += conditionText(c, condFields, choiceList);
  });
  return out;
}

function conditionText(
  c: { field?: string; oper?: string; value?: unknown; value2?: unknown },
  condFields: CondFieldDef[],
  choiceList: (key: string) => { value: string | number; label: string }[]
): string {
  const def = condFields.find((x) => x.field === c.field);
  const label = def ? def.label : String(c.field ?? "");
  const op = COND_OP_LABELS[c.oper || ""] || String(c.oper ?? "");
  if (c.oper === "isEmpty" || c.oper === "isNotEmpty") return `${label} ${op}`;

  let val = String(c.value ?? "");
  if (def?.type === "choice") {
    const hit = choiceList(def.choicesKey || "").find((v) => String(v.value) === val);
    if (hit) val = hit.label;
  }
  if (c.oper === "between") return `${label} between ${val} and ${c.value2}`;
  return `${label} ${op} ${val}`;
}

export function panelChoiceList(key: string, ticketType: string) {
  if (key === "states") return snStateChoices(ticketType);
  if (key === "incidentStates") return snStateChoices("incident");
  if (key === "priorities") return SN_PRIORITY_CHOICES;
  return [];
}

export { SETTINGS_REPO };

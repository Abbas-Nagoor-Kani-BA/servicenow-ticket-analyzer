const SN_STATE_MAPS: Record<string, Record<string, string>> = {
  incident: { "1": "New", "2": "In Progress", "3": "On Hold", "6": "Resolved", "7": "Closed", "8": "Canceled" },
  // change_request updated from a live instance (choice XML): New(-5), Assess(-4),
  // Authorize(-3), Scheduled(-2), Implement(-1), Review(0), Closed(3), Cancelled(4).
  change_request: { "-5": "New", "-4": "Assess", "-3": "Authorize", "-2": "Scheduled", "-1": "Implement", "0": "Review", "3": "Closed", "4": "Cancelled" },
  // problem updated from a live instance (choice XML): fully custom values 151-157;
  // OOB (-5 New … 7 Closed) are not used on this instance
  problem: { "101": "New", "102": "Assess", "103":"root cause analysis","104": "fix in Progress","106":"resolved", "157": "Closed" },
  sc_req_item: { "-5": "Pending", "1": "Open", "2": "Work in Progress", "3": "Closed Complete", "4": "Closed Incomplete", "7": "Closed Skipped" },
  // sc_task updated from a live instance (choice XML): custom pending states,
  // Reopen(6)/Completed(14)/Closed Cancelled(15); OOB -5/7 are not used here
  sc_task: { "1": "Open", "2": "In progress", "3": "Closed Complete", "4": "Closed Incomplete", "6": "Reopen", "11": "Pending Supplier", "12": "Pending User Info", "13": "Pending Procurement", "14": "Completed", "15": "Closed Cancelled", "20": "Pending Change", "24": "Pending Procurement - Approval" }
};

const SN_PRIORITY_CHOICES = [
  { value: "1", label: "1 - Critical" },
  { value: "2", label: "2 - High" },
  { value: "3", label: "3 - Moderate" },
  { value: "4", label: "4 - Low" }
];

const SN_TABLE_LABELS: Record<string, string> = {
  incident: "Incident",
  change_request: "Change Request",
  problem: "Problem",
  sc_req_item: "Requested Item",
  sc_task: "Catalog Task"
};

/**
 * Human-readable label for a ticket table.
 *
 * Exists because `SN_TABLE_LABELS` is a closed record with no index signature,
 * so `SN_TABLE_LABELS[someString]` does not type-check. Callers were each
 * casting it locally; this is that cast, once.
 *
 * @param {string} table
 * @returns {string} the label, or the table name when unknown
 */
function snTableLabel(table: string): string {
  return SN_TABLE_LABELS[table] || table;
}

function snStateMap(table: string): Record<string, string> {
  const t = table || "incident";
  if (SN_STATE_MAPS[t]) return SN_STATE_MAPS[t];
  return SN_STATE_MAPS.sc_req_item;
}

function snStateChoices(table: string): Array<{ value: string; label: string }> {
  return Object.entries(snStateMap(table)).map(([value, label]) => ({ value, label }));
}


export { SN_STATE_MAPS, SN_TABLE_LABELS, SN_PRIORITY_CHOICES, snStateMap, snStateChoices, snTableLabel };

function sanitizeValue(v) {
  return String(v ?? "").replace(/['\\]/g, "");
}

function encodeCondition(c) {
  const f = c.field;
  switch (c.oper) {
    case "isEmpty": return `${f}ISEMPTY`;
    case "isNotEmpty": return `${f}ISNOTEMPTY`;
    case "eq": return `${f}=${sanitizeValue(c.value)}`;
    case "neq": return `${f}!=${sanitizeValue(c.value)}`;
    case "contains": return `${f}LIKE${sanitizeValue(c.value)}`;
    case "notContains": return `${f}NOT LIKE${sanitizeValue(c.value)}`;
    case "startsWith": return `${f}STARTSWITH${sanitizeValue(c.value)}`;
    case "before":
      return `${f}<=javascript:gs.dateGenerate('${sanitizeValue(c.value)}','00:00:00')`;
    case "after":
      return `${f}>=javascript:gs.dateGenerate('${sanitizeValue(c.value)}','23:59:59')`;
    case "between":
      return `${f}BETWEENjavascript:gs.dateGenerate('${sanitizeValue(c.value)}','00:00:00')` +
        `@javascript:gs.dateGenerate('${sanitizeValue(c.value2)}','23:59:59')`;
    default: return "";
  }
}

/**
 * Encode an AND/OR list of condition objects into an encoded-query fragment.
 * Conditions fragment MUST be emitted FIRST (callers do) because SN evaluates
 * encoded queries strictly left-to-right and a trailing ^OR would OR over the
 * whole preceding scope. Emits nothing for unknown operators.
 * @param {Array<{field:string, oper:string, value?:string, value2?:string, join?:string}>} list
 * @returns {string}
 */
function encodeConditions(list) {
  let out = "";
  let outputCount = 0;
  (list || []).forEach(c => {
    const body = encodeCondition(c);
    if (!body) return;
    out += outputCount === 0 ? body : (c.join === "OR" ? "^OR" : "^") + body;
    outputCount++;
  });
  return out;
}

/**
 * Build a complete encoded query string from a config object.
 * @param {object} cfg
 * @param {string} [cfg.dateField]
 * @param {Array} [cfg.conditions]
 * @param {string} [cfg.from]
 * @param {string} [cfg.to]
 * @param {Array<string>} [cfg.states]
 * @param {Array<string>} [cfg.priorities]
 * @param {Array<string>} [cfg.groupNames]
 * @param {string} [cfg.rawQuery]
 * @throws {Error} if rawQuery contains a top-level ^OR
 * @returns {string}
 */
function buildEncodedQuery(cfg) {
  const parts = [];
  const dateField = cfg.dateField || "opened_at";

  if (cfg.conditions?.length) {
    const frag = encodeConditions(cfg.conditions);
    if (frag) parts.push(frag);
  }

  if (cfg.from && cfg.to) {
    parts.push(
      `${dateField}BETWEENjavascript:gs.dateGenerate('${cfg.from}','00:00:00')` +
      `@javascript:gs.dateGenerate('${cfg.to}','23:59:59')`
    );
  } else if (cfg.from) {
    parts.push(`${dateField}>=javascript:gs.dateGenerate('${cfg.from}','00:00:00')`);
  } else if (cfg.to) {
    parts.push(`${dateField}<=javascript:gs.dateGenerate('${cfg.to}','23:59:59')`);
  }

  if (cfg.states?.length) {
    const vals = cfg.states.filter(v => v !== "" && v !== null).map(String);
    if (vals.length) parts.push(`stateIN${vals.join(",")}`);
  }

  if (cfg.priorities?.length) {
    const vals = cfg.priorities.filter(v => v !== "" && v !== null).map(String);
    if (vals.length) parts.push(`priorityIN${vals.join(",")}`);
  }

  if (Array.isArray(cfg.groupNames) && cfg.groupNames.length) {
    parts.push(`assignment_group.nameIN${cfg.groupNames.map(sanitizeValue).join(",")}`);
  }

  const raw = (cfg.rawQuery || "").trim();
  if (raw) {
    // A top-level OR (^OR or a leading OR) would OR over every preceding scope
    // (dates, state/priority, queue scoping) because encoded queries evaluate
    // strictly left-to-right — that leaks the query to (almost) the whole table.
    // In encoded-query syntax "^OR" is always an operator (no separator before
    // the next field name), so any occurrence is rejected.
    if (/(^|\^)OR/.test(raw)) {
      throw new Error(
        "Raw query cannot contain top-level OR (^OR) — it would bypass date and queue scoping. Add OR conditions via the condition builder instead"
      );
    }
    parts.push(raw);
  }

  return parts.join("^");
}

export { encodeConditions, buildEncodedQuery };

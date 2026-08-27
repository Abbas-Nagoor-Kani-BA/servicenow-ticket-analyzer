# Ticket Filtering — How It Works

This document explains how the ServiceNow Ticket Analyzer filters tickets, from
the side-panel UI down to the REST call sent to ServiceNow.

Filtering happens in **three layers**:

```
panel/panel.js        → collects filter config from the UI
lib/querybuilder.js   → converts config → ServiceNow encoded query string
background.js         → merges queue scope, executes count + paginated fetch
```

---

## 1. Filter definition in the UI (`panel/panel.js`)

The panel builds a filter config object with `currentFilters()`:

```js
{ table: "incident", conditions: [...], rawQuery: "..." }
```

### Ticket type (table)

A dropdown selects the table to query: `incident`, `change_request`,
`problem`, `sc_req_item` (RITM) or `sc_task` (SCTASK). Changing it re-renders
the condition rows because some fields are table-specific:

| Field | Available on |
|---|---|
| `incident_state` | incident only |
| `closed_at` | incident, problem, RITM, SCTASK |
| `resolved_at` | incident, problem, RITM |

### Condition builder

Rows are defined in `COND_FIELDS`: assigned to, state, priority, group,
configuration item, short description, number, created/closed/resolved dates.

Each row produces one condition object:

```js
{ join: "AND" | "OR", field: "assigned_to", oper: "isEmpty", value: "", value2: "" }
```

- **Operators** come from `COND_OPS[def.type]`:
  - reference fields (`assigned_to`, group): `isEmpty`, `isNotEmpty`
  - string fields (`cmdb_ci.name`, short description, number): `contains`, `notContains`, `startsWith`, `eq`, `isEmpty`, `isNotEmpty`
  - choice fields (state/priority): dropdown values from the OOB maps in `lib/statechoices.js`
  - date fields: `before`, `after`, `between`
- **Validation** in `collectConditions()`: operator must be known; a value is
  required unless the operator is `isEmpty`/`isNotEmpty`; `between` requires a
  second date.
- The first condition's join is forced to `AND`.
- Reference columns only offer is-empty / is-not-empty — no text operators or
  sys_id resolution is performed client-side. The CI field dot-walks to
  `cmdb_ci.name` so string operators match the display name.

### Raw query

A free-text field appended verbatim as an encoded-query fragment. It applies to
every filter set in a run.

### Filter sets

Multiple named filter sets can be saved (`filterList`). Sets are deduplicated by
a fingerprint of `[table, conditions]`. On **Run**, every saved set is executed
as its own server-side query; all sets share the live raw query:

```js
const sets = filterList.length
  ? filterList.map(f => ({ ...f, rawQuery: live.rawQuery }))
  : [live];
```

Sets may mix ticket types; results are grouped per table and unioned by `sys_id`.

### Live preview

`refreshGenerated()` runs the query builder on every input and displays the
resulting encoded query before any request is made. The **Preview** button sends
a `COUNT` message to the background script and shows how many tickets match.

---

## 2. Query building (`lib/querybuilder.js`)

`buildEncodedQuery(cfg)` converts the config into a ServiceNow **encoded query**
string. Parts are joined with `^` (logical AND); within the conditions fragment,
OR joins use `^OR`.

Order matters: the conditions fragment is emitted **first**, because
ServiceNow evaluates encoded queries strictly left-to-right — a `^OR` placed
after other ANDed scopes would OR over the entire preceding expression and leak
past the queue scoping.

### Condition encoding (`encodeCondition`)

| Operator | Encoded form |
|---|---|
| `isEmpty` | `<field>ISEMPTY` |
| `isNotEmpty` | `<field>ISNOTEMPTY` |
| `eq` | `<field>=<value>` |
| `neq` | `<field>!=<value>` |
| `contains` | `<field>LIKE<value>` |
| `notContains` | `<field>NOT LIKE<value>` |
| `startsWith` | `<field>STARTSWITH<value>` |
| `before` | `<field><=javascript:gs.dateGenerate('<v>','00:00:00')` |
| `after` | `<field>>=javascript:gs.dateGenerate('<v>','23:59:59')` |
| `between` | `<field>BETWEENjavascript:gs.dateGenerate('<v1>','00:00:00')@javascript:gs.dateGenerate('<v2>','23:59:59')` |

Date bounds are inclusive full days (`00:00:00` – `23:59:59`).
All values pass through `sanitizeValue()`, which strips `'` and `\`.

### Assembled parts

1. **Conditions fragment** (always first, see above).
2. **Date range** on `cfg.dateField` (default `opened_at`):
   - both from+to → `BETWEEN`
   - from only → `>=`
   - to only → `<=`
3. **States**: `stateIN<comma-separated values>` (empty entries dropped)
4. **Priorities**: `priorityIN...`
5. **Queue scope**: `assignment_group.nameIN<group names>` — injected by the
   background script whenever groups are present, unconditionally. Group names
   go through `sanitizeValue`; names containing commas cannot be expressed in an
   IN list.
6. **Raw query** appended last.

### Example

Conditions: *Assigned-to is empty OR State = In Progress*, dates 2025-01-01 →
2025-01-31, queues "Service Desk,Network":

```
assigned_toISEMPTY^ORstate=2^opened_atBETWEENjavascript:gs.dateGenerate('2025-01-01','00:00:00')@javascript:gs.dateGenerate('2025-01-31','23:59:59')^assignment_group.nameINService Desk,Network
```

---

## 3. Execution in the background script (`background.js`)

### Queue scope enforcement

`scopeGroups(msg)` reads the configured queue NAMES from settings
(`pluginSettings.defaults.queues`) and throws if none exist. `groupScopeOf()`
wraps them as `{ groupNames }`, merged into **every** built query — users can
only pull tickets from their configured teams. Legacy `memberSysIds` saved in
old filters are stripped before the query is built (team members are used for
acknowledgement detection only, never for filtering).

### Count path (`handleCount`)

Used by the panel's Preview button:

1. Build the encoded query.
2. Call `client.count(table, encodedQuery)` — a Table API request with
   `sysparm_limit=1` that reads the match total from the `x-total-count`
   response header.
3. Return `{ ok, total, encodedQuery }`.

### Run path (`runPull`)

For each filter set `i` of `filterSets[]`:

1. **Build** the per-set encoded query (set config + queue scope).
2. **Count** matches; if 0, record the entry and skip.
3. **Cache lookup**: `SnCache.getQuery(table, encodedQuery)` — the encoded query
   doubles as the cache key. If a fresh cached result exists, records are reused
   with zero API calls (progress log shows "CACHE HIT" with the cache age);
   otherwise records are fetched and written back via `SnCache.putQuery()`.
4. **Fetch**: `client.fetchAllRecords(table, encodedQuery, fields, ...)` pages
   through `/api/now/table/<table>` with:
   - `sysparm_query` = the encoded query
   - `sysparm_limit` = 1000, `sysparm_offset` incremented per page
   - `sysparm_display_value=all` (each value arrives as
     `{ display_value, value }`)
5. **Dedupe/union**: records are keyed by `sys_id` into a per-table map;
   duplicates across overlapping filter sets are dropped (`fresh` counter tracks
   new additions).
6. One `runs[]` history entry is recorded per set with its query, pulled count,
   cache status, etc.

After all sets complete, Phase 2 fetches timeline events per table for the
fields relevant to timeline analysis (`assignment_group`, `assigned_to`,
`state`) via `fetchTimelineEvents()`; events are filtered again client-side with
`.filter(e => wanted.has(e.field))`.

---

## Summary

UI conditions + raw query → validated config → encoded query string
(conditions first, then date/state/priority IN-lists, unconditional queue scope,
raw query last) → used as both the ServiceNow `sysparm_query` and the response
cache key, executed per filter set with pagination and sys_id deduplication.

# Readability & Maintainability Plan

Generated from full codebase analysis. ~8,300 lines of JS across ~55 files.

---

## Priority 1: Bug Fixes

### BUG-001: Cache TTL never enforced ~~FIXED~~

**File:** `lib/cache.js:98`
**Severity:** High
**Fixed:** 2026-08-27

`QUERY_TTL_MS` is a function wrapping a variable, but line 98 referenced it as a
property (`now - QUERY_TTL_MS`) instead of calling it (`now - QUERY_TTL_MS()`).
This evaluated to `NaN`, causing every cache entry to be purged on every
`purgeExpired` call. Changed to `QUERY_TTL_MS()`.

### BUG-002: Queue names resolve to undefined in lastRun metadata ~~FIXED~~

**File:** `background.js`
**Severity:** Low (display-only)
**Fixed:** 2026-08-27 — resolved as part of LONG-001 decomposition.

`groups` at this point is an array of strings (from `scopeGroups`), not objects.
`.name` on a string returns `undefined`, so `groups.map((g) => g.name).join(", ")`
produces `", , ,"`. Changed to `groups.join(", ")` in `persistResults`.

---

## Priority 2: Delete Stale Files ~~COMPLETED~~

All three files deleted on 2026-08-27.

### STALE-001: `viewer/h` (274 lines) ~~DELETED~~

Alternate pre-modular HTML file with classic `<script>` tag loading instead of ES
modules. Leftover from the modular refactoring. Contains duplicate CSS rules
(e.g. `.msrPickItem:hover` defined twice).

### STALE-002: `viewer/viewer.css` ~~DELETED~~

Empty file (0 lines). Dead artifact.

### STALE-003: `content.txt` ~~DELETED~~

Debug log snippet (`ReferenceError: activeFinish is not defined`). Not source
code.

---

## Priority 3: Deduplication

### DEDUP-001: `parseSnDisplayMs` + `pmHour` duplicated with inconsistent behavior ~~FIXED~~

**Fixed:** 2026-08-29 — local copy removed from `analysis/phase2.js`; imports the
canonical `parseSnDisplayMs` from `lib/sntime.js`. Behavior preserved (`scanSnDateTime`
checks `Number.isFinite`, which is false for both the old `NaN` and the canonical `null`).

**Locations:**
- `analysis/phase2.js:226-243` (local copy, returns `NaN` on failure)
- `lib/sntime.js:1-19` (canonical, returns `null` on failure)

Same function, different failure return values. Consumers must handle both
`NaN` and `null` depending on which module they call.

**Action:** Remove the copy from `phase2.js`. Import from `lib/sntime.js`.
Fix all callers to handle `null` (the canonical return).

### DEDUP-002: `hmsToHours` duplicated ~~WON'T FIX (semantics differ)~~

**Deferred:** 2026-08-29 — the two copies have genuinely different behavior
(`report.js` returns `0` for empty, `msrchoices.js` returns `NaN`; also differ on
`parseInt` radix). Consolidating would change one caller's semantics. Left as-is;
revisit only if both callers can agree on one behavior.

**Locations:**
- `analysis/report.js:31-35`
- `lib/msrchoices.js:159-164`

Both parse `H:M:S` strings. The `msrchoices.js` version adds NaN checks;
the `report.js` version handles empty/zero differently.

**Action:** Extract to a single location (e.g. `lib/numutils.js` or
`lib/markup.js`) and import in both places.

### DEDUP-003: `TABLE_LABELS` — three different mappings for the same concept ~~FIXED~~

**Fixed:** 2026-08-27

Three separate label sets (`background.js`, `panel/panel.js`, `viewer/js/30-grid.js`)
consolidated into a single `SN_TABLE_LABELS` export in `lib/statechoices.js`.
All three consumers now import from there. The viewer's inline `TABLE_LABEL`
function was removed entirely.

### DEDUP-004: `$` (getElementById shorthand) defined in three files

**Locations:**
- `panel/panel.js:4`
- `viewer/js/00-core.js:5`
- `settings/settings.js:4`

All define `const $ = id => document.getElementById(id)`.

**Action:** Export from `lib/markup.js` (or leave inline since it's one line
and each file is a separate module scope — but be aware of the duplication).

### DEDUP-005: Search picker pattern duplicated between viewer modules

**Locations:**
- `viewer/js/70-editors.js:10-193` (inline in `startEdit`)
- `viewer/js/50-ticketpop.js:32-148` (`attachSearchPick`)

Both implement the same search/keyboard/paint/navigate pattern with
near-identical code (~130 lines each).

**Action:** Extract shared search-picker logic into a new
`viewer/js/search-picker.js` helper.

---

## Priority 4: Break Up Long Functions ~~COMPLETED~~

All four items decomposed on 2026-08-27. All syntax checks and 13 test suites pass.

### LONG-001: `background.js` — `runPull` ~~FIXED~~

**Before:** 200-line async function handling fetch, cache, phase-2, merge, persist, and progress.
**After:** `runPull` = ~55 lines; three extracted helpers.

**Extracted functions:**
- `processFilterSet(client, set, index, totalSets, groupScope, fields, maxTickets, abortSignal)` — count check, cache lookup, paginated fetch for one filter set. Returns `{ table, query, pulled, cached, cacheAt, planned, pulledDelta, records, skippedLimit, matched }`.
- `fetchTimelines(client, records, table, abortSignal, membersByQueue, teamNames)` — timeline cache check, `fetchTimelineEvents`, `putTimelines`, `analyzeAll` for one table. Returns `{ rows, missingAudit, auditCount, sampleAuditRows, sampleRecord }`.
- `persistResults(rows, runEntries, missingAudit, auditCounts, sampleAuditRows, sampleRecord, msg, groups, plannedSum)` — `mergeRows`, `chrome.storage.local.set` (lastData + lastRun), `DATA_UPDATED` broadcast, done progress message.

**Also fixed:** BUG-002 (`groups.map((g) => g.name).join(", ")` → `groups.join(", ")`).

### LONG-002: `panel/panel.js` — `renderCondRows` ~~FIXED~~

**Before:** 135 lines of imperative DOM construction with nested event handlers.
**After:** `renderCondRows` = ~25 lines; four extracted helpers.

**Extracted functions:**
- `createJoinSelector(row)` — AND/OR `<select>` for rows after the first. Returns the element.
- `createFieldSelector(row)` — field `<select>` with allowed-fields validation and change handler. Returns the element.
- `createValueWidget(def, row)` — choice `<select>`, text `<input>`, or date `<input>` (with second input for `between`). Returns the element (or a `<span>` wrapping two inputs).
- `createDeleteButton(index)` — remove-condition `<button>` with splice + re-render. Returns the element.

**Also fixed:** `var condRows` → `let condRows` (CLEAN-002).

### LONG-003: `viewer/js/70-editors.js` — `startEdit` ~~FIXED~~

**Before:** 233 lines with two major branches (option picker vs text input) sharing outer variables.
**After:** `startEdit` = ~20 lines; two extracted helpers.

**Extracted functions:**
- `createOptionPicker(td, row, key)` — builds the `msrPick` popup with search, filtered list, keyboard navigation, pointer-select, and commit logic. Returns a `finish` function.
- `createTextInput(td, row, key, cls)` — creates an `<input>` with Enter/Tab/Escape/blur handlers and date validation. Returns a `finish` function.

`startEdit` is now a thin dispatcher: validates the cell, checks for options, and delegates to the appropriate creator.

### LONG-004: `viewer/js/50-ticketpop.js` — `openTicketPopup` ~~FIXED~~

**Before:** 161 lines building a complex two-pane popup with inline event handlers.
**After:** `openTicketPopup` = ~30 lines; two extracted helpers.

**Extracted functions:**
- `buildTicketLeftPane(row, placePop)` — number display, solutionType/rootCause picker fields, timeline date fields (assign/ackn/suspend/resume). Returns the left `<div>`.
- `buildTicketRightPane(row)` — summary section and transitions list (queue/assignee/state changes from activity). Returns the right `<div>`.

`openTicketPopup` is now a thin shell: creates the popup, calls both builders, attaches doc-level Escape/click handlers, and positions.

---

## Priority 5: Fix Architectural Issues

### ARCH-001: Circular dependency between `00-core.js` and `30-grid.js` ~~FIXED~~

**Fixed:** 2026-08-29 — broken via new `viewer/js/05-cols.js` (toolbar column/
clear/reset wiring moved out of `00-core`; see `docs/architecture.md`).

`viewer/js/00-core.js:2` imports from `30-grid.js`:
```js
import { buildHead, hasDataRows, load, render, selfPush } from "./30-grid.js";
```

Meanwhile `30-grid.js:4` imports from `00-core.js`:
```js
import { $, COLUMNS, cellShort, ... } from "./00-core.js";
```

ES modules handle this via live bindings, but it makes the module graph
fragile and hard to reason about.

**Also fixed 2026-08-29:** the second circular pair `20-toolbar ↔ 25-dialogs` was
broken via a shared `viewer/js/05-config-state.js` (CI-split/export-config state +
accessors, with `20-toolbar` registering a refresh callback via `setOnConfigChange`).
`25-dialogs` now imports the shared state and no longer imports `20-toolbar`.

**Also fixed 2026-08-29:** the third circular pair `30-grid ↔ 40-selection` was
broken by moving the pure view accessors (`currentRows`, `hasDataRows`,
`parseLocalInput`) into a leaf `viewer/js/03-grid-data.js` and having `30-grid`
receive its selection operations (`highlight`, `clearUndo`, `restorePending`,
`ensureDefault`) via `setSelectionHooks(...)`, which `40-selection` registers once
at module load. `30-grid` no longer imports `40-selection` at all, so the longer
`40-selection → 15-clipboard → 10-exporter → 30-grid` path is acyclic too.
No known circular imports remain.
**Action:** Move `buildHead`/`render`/`load` to a new `viewer/js/05-layout.js`
or restructure so `00-core.js` doesn't import from `30-grid.js`.

### ARCH-002: `globalThis.Analysis` cross-module global

`background.js:9` assigns `globalThis.Analysis = Analysis`. This is needed
because `lib/servicenow.js:177` reads `Analysis` as a global
(`const A = Analysis`). Antipattern in a codebase that otherwise uses ES
module exports.

**Action:** Convert the global reference in `servicenow.js` to a proper ES
module import.

### ARCH-003: Mutable state exported as raw bindings ~~FIXED~~

**Fixed:** 2026-08-27 (via `00-store` refactor, verified no `export let` remains)
+ **2026-08-29** removed the remaining dead raw-mutable exports (`mapWorking`,
`mapSelects`, `popTargetFid`, `ciDraft`, `ciDragSrc` from `25-dialogs`; `tplInfo`
from `20-toolbar`) — all were exported but unused externally. Shared config state
now lives in `05-config-state.js` behind accessor functions.

Multiple modules export mutable `let` bindings that can be reassigned
without any tracking:

| Module | Exports |
|---|---|
| `viewer/js/00-core.js:222` | `hiddenCols` (Set) |
| `viewer/js/30-grid.js:287-290` | `data`, `snOffsetMs`, `saveTimer`, `selfPush` |
| `viewer/js/40-selection.js:7-10` | `selAnchor`, `selFocus`, `selPrev`, `pendingSel` |

**Action:** Export accessor functions instead:
```js
// Instead of:
export let data = [];
export const getData = () => data;
export const setData = (v) => { data = v; };
```

---

## Priority 6: Clean Up Inconsistencies

### CLEAN-001: Debug `console.log` in production code ~~FIXED~~

**File:** `viewer/js/00-core.js:40`
**Fixed:** 2026-08-27

Every viewer page load printed a debug build timestamp to the console.
Removed.

### CLEAN-002: `var` in ES module codebase ~~FIXED~~

**File:** `panel/panel.js:244`
**Fixed:** 2026-08-27 — resolved as part of LONG-002 decomposition.

Uses `var condRows = []` while the rest of the codebase uses `let`/`const`.
Leftover from pre-refactor state. Changed to `let condRows = []`.

### CLEAN-003: Mixed DOM access patterns

Some files use `$("id")` shorthand, others use `document.getElementById()`.
`viewer/js/30-grid.js` mixes both in the same file.

**Action:** Pick one convention per file; ideally the shorthand everywhere.

### CLEAN-004: Excessive blank lines ~~FIXED~~

**File:** `viewer/js/20-toolbar.js:193-204`
**Fixed:** 2026-08-27

12 blank lines between functions reduced to 1.

### CLEAN-005: Unlabeled intentional typos in fuzzy-match data ~~ALREADY DOCUMENTED~~

**File:** `analysis/aiextract.js:41-42`

A comment already exists: "Known section headers. Variants include common typos
and rewordings; matching itself is fuzzy (distance 1-2 depending on label length)."
No action needed.

---

## Priority 7: Add Missing Tests

| Module | Current Coverage | Notes |
|---|---|---|
| `lib/cache.js` | None | IndexedDB caching — needs mock |
| `lib/markup.js` | None | Pure functions — easy to test |
| `lib/rowmerge.js` | Minimal (22-line test) | Needs edge cases |
| `settings/settings.js` | None | DOM + Chrome APIs — hardest |
| `panel/panel.js` | None | DOM + Chrome APIs — needs harness |

---

## Summary

| Category | Items | Status | Notes |
|---|---|---|---|
| Bug fixes | 2 | **2/2 done** | Both fixed |
| File cleanup | 3 | **3/3 done** | All deleted |
| Deduplication | 5 | 2/5 done | DEDUP-001, 003 fixed; 002/004/005 pending |
| Function decomposition | 4 | **4/4 done** | All decomposed, all tests pass |
| Architectural fixes | 3 | 3/3 done | ARCH-001 (all three cycles, incl. `30-grid ↔ 40-selection`) + ARCH-003 fixed; ARCH-002 (globalThis.Analysis) pending |
| Consistency cleanup | 5 | **5/5 done** | All resolved or already documented |
| Missing tests | 5 | 0/5 done | |

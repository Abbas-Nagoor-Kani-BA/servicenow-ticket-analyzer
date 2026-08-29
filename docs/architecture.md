# Viewer Architecture

How the full-tab **data view** (`viewer/viewer.html`) is structured. This page is
a hand-rolled spreadsheet: no framework, raw `document.createElement`, manual
selection/fill/undo, and a shared reactive store. Understanding the module graph
and the "source of truth" split is the key to working here safely.

---

## 1. Module graph (post-refactor)

`viewer/js/viewer.js` is the single entry point. It imports the ordered modules,
then `boot()` wires the stores and renders. Dependency edges below (arrows =
"imports from"); strict one-directional unless noted.

```
00-store  (state stores + accessors — leaf, imports only lib/)
   ▲
00-core   (pure helpers: $, COLUMNS, cellShort, visibleCols, setStatus, ...)  → 00-store
   ▲
05-config-state  (shared CI-split + export-config state, accessors only)      → 00-core
   ▲            ▲
   │            └─50-ticketpop, 70-editors, 95-interactions ...
   │
10-exporter (export column map)  → 30-grid
   ▲
15-clipboard (TSV for copy)      → 10-exporter, 30-grid
   ▲
16-summary (Summary SLA tab)     → 00-store only  ★ must NOT import 00-core/30-grid
17-paste (leaf helpers)
15-picker (MSR nested picker)

30-grid (load, render, buildHead, fmtInstant, save pipeline)                  → 00-core, 00-store, 16-summary, 03-grid-data
    ▲
40-selection (range model, highlight, undo, fill)                             → 00-core, 00-store, 30-grid, 03-grid-data, 15-clipboard, 17-paste, 85-shared
    ▲
03-grid-data (pure view accessors: currentRows, hasDataRows, parseLocalInput) → 00-core, 00-store
   ▲
60-activity (activity pane)      → 00-core, 30-grid
   ▲
70-editors (inline/combobox edit)→ 00-core, 30-grid, 40-selection, 15-picker, 60-activity
   ▲
50-ticketpop (Number click popup)→ 00-core, 00-store, 15-picker, 30-grid
   ▲
95-interactions (table mouse/keys, drag select, fill)                         → 00-core, 30-grid, 40-selection, 50-ticketpop, 70-editors
```

**20-toolbar** imports `25-dialogs` (**one-way**, for `openCiDialog`/`openMapDialog`/`hideLetterPop`) and `05-config-state` — both directions move through `05-config-state`, so the toolbar↔dialogs cycle is gone.

### Removed circular imports
- `00-core ↔ 30-grid` — **broken** (was ARCH-001): the toolbar column/clear/reset wiring that needed `buildHead/load/render/resetColWidths` now lives in `05-cols.js`; `00-core` is a pure-helpers leaf.
- `20-toolbar ↔ 25-dialogs` — **broken**: the CI-split + export-config **state** (with accessors) moved to `05-config-state.js`; `20-toolbar` registers its refresh callback via `setOnConfigChange(...)` so the state module never imports back.
- `30-grid ↔ 40-selection` — **broken**: the pure view accessors (`currentRows`, `hasDataRows`, `parseLocalInput`) moved to `03-grid-data.js` (a leaf, so both `30-grid` and `40-selection` import it without cycling), and `30-grid` no longer imports `40-selection` at all — it receives the four selection operations (`highlight`, `clearUndo`, `restorePending`, `ensureDefault`) through `setSelectionHooks(...)`, which `40-selection` registers once at module load. The longer `40-selection → 15-clipboard → 10-exporter → 30-grid` path is now acyclic too, because `30-grid` no longer routes back into that subgraph. `30-grid` still re-exports `currentRows/hasDataRows/parseLocalInput` (imported from `03-grid-data`) so existing importers (`20-toolbar`, `70-editors`, `50-ticketpop`) keep working unchanged.

No known circular imports remain.

---

## 2. Where the "source of truth" lives

The grid's displayed state is **not** in one place. It is split across:

1. **`dataStore`** (`00-store.js`) — `state.data` (the row array), `sortKey`, `sortDir`, `snOffsetMs`, `saveTimer`. Read via `dataStore.getState()`, written via `dataStore.setState({...})`.
2. **`uiStore`** (`00-store.js`) — `hiddenCols` (Set). Access via `hideStore()`/`setHiddenCols`.
3. **`selStore`** (`00-store.js`) — selection anchor/focus. Access via `40-selection` accessors.
4. **Module-local `let` state** (NOT in stores, NOT exported): `resizeState` (`30-grid`), `activeFinish` (`70-editors` — the single currently-open editor), `ticketPopState`/`nestedPickState` (`50-ticketpop`), `dragSelecting`/`fillDragging` (`95-interactions`), the dialog draft state (`25-dialogs`: `mapWorking`, `ciDraft`, ...).
5. **Mutated row objects** — some values are stamped onto `row` itself: `row.solutionType`/`rootCause`/`parseReview` (`autoParse`, editors), and the report memo `row.__report`/`__reportKey` (`report.js`).

**Rule of thumb:** don't add a new top-level `const`/`let` to a viewer module unless you check it isn't already owned somewhere. A name collision between two modules sharing page-global scope once crashed the viewer (the `const G` incident). Prefer putting shared mutable state into `00-store` behind accessor functions, as `05-config-state` does.

---

## 3. Render / edit / save lifecycle

```
load(data)           30-grid: set dataStore, autoParse(), migrateLegacyResolutions(),
                     buildHead(), render(), restorePendingSel(), ensureDefaultSelection(),
                     attachSummaryToData(), renderSummary()
   │
render()             30-grid: currentRows()  (filter+sort à la search box),
                     buildTableRows(...), updateFooter, applySelHighlight, renderSummary()
   │
edit (dblclick)      70-editors startEdit → option-picker OR text input → finish(commit, move)
   │                 mutates row[key], calls scheduleSave()
   ▼
scheduleSave()       30-grid: debounced (350ms) → saveData() → attachSummaryToData +
                     chrome.storage.local.set(lastData) + DATA_UPDATED broadcast
```

- `currentRows()` is the **only** canonical filtered/sorted view; selections (in `40-selection`) are expressed as anchor/focus **sysIds + column keys**, re-resolved over `currentRows()` — so any filter/sort/resort invalidates a selection.
- `render()` bails out if a `td.edit-input` is open (editors live outside the table re-render window).
- Edits are persisted to `lastData`; the viewer listens for external `DATA_UPDATED` to refresh.

---

## 4. Timezone handling (the instance clock)

All displayed times must match the **ServiceNow instance clock** (what the Activity UI
shows), never the browser. The only reliable oracle is each record's display/raw
datetime pair. See `docs/timeline.md` and `lib/sntime.js`.

- `30-grid.fmtInstant(utcIso, row)` resolves each row's **own** offset from its
  `openedAt`/`openedAtRaw` pair (`rowOffsetMs` + a fallback `snOffsetMs` from
  `detectSnOffsetMs`), so rows across DST seasons stay correct.
- Read all raw companion fields via `sysparm_display_value:"all"`.

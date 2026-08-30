# Roadmap — what remains after Phase 6

Everything that is still to be done on this project, in order, with details.
The migration proper (Phases 0–6) is done and merged into `main`. This file
covers what comes next: closing the remaining migration gaps, finishing the
TypeScript migration, extracting the last services, and the feature backlog.

Reference point: `docs/layered-architecture.md` is the target architecture;
`docs/migration-plan.md` is the record of what was already done. `AGENTS.md`
is the working convention doc — update it whenever this plan changes what is
true about the codebase.

## Gate (after every phase)

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

- `npm test` is `node --test "tools/*-test.*"` — a **glob**, not a directory
  (`node --test tools` fails in Node 25).
- `npm run typecheck` runs BOTH `tsconfig.json` and `tsconfig.strict.json`.
- Every phase lands as one or more **commits, each independently green** — the
  standing rule is: work done, gate green, commit.
- Nothing is pushed to the remote unless explicitly asked. The repo is local.

## Current state (baseline)

- `main` carries Phases 0–5 (migration), all committed and green. **Phase 6
  (viewer composition root) lives unmerged on branch
  `refactor/viewer-composition-root`** — the first blocking action for this
  roadmap is to decide whether it lands on `main` before Phase 7 starts.
  Nothing on the later phases depends on unmerging it; Phase 7 branches from
  wherever the viewer work lands.
- **Strict TypeScript:** 40 files on `tsconfig.strict.json`
  (everything in `di/`, `data/`, `services/`, `components/`, the three
  `surfaces/*/index.ts`, `lib/keys.ts`).
- **JavaScript still .js (~6,150 lines):**

| Area | Files | Lines | Notes |
|---|---|---|---|
| `core/` | 12 | 1,973 | pure domain; runs standalone in node; best first target |
| `surfaces/viewer/` | 18 | 2,722 | page modules; UI already in components/ |
| `panel/panel.js` | 1 | 364 | bootstrap + handlers |
| `settings/settings.js` | 1 | 206 | bootstrap + I/O orchestration |
| `lib/` | 8 | 725 | markup, picklist, servicenow, storage, store, toast, tooltip, format |
| `background.js` | 1 | 129 | message router |
| `content/content.js` | 1 | 37 | **must stay classic JS — see note** |

- **Services that exist:** `pull`, `connection`, `settings`, `queue-scope`.
  **Services the architecture still names but do not exist:** `timeline`,
  `report`, `export`, `extract`, `remote-bridge` (architecture §5 / §7).

---

## Phase 7 — Close the Phase-5/4 leftovers (small, quick wins)

Three loose ends from earlier checklists. Each is a single commit, individually
green. Do these first — they are small, they tidy the plan record, and they
make the later phases quieter.

### 7a. `background.js` → `platform/background.ts`

- [x] Goal: finish the one unchecked Phase-5 box ("Move `background.js` →
      `platform/background.ts`"). It is already a 129-line router; this is
      relocation plus type-conversion, not redesign.
- **Steps**
  1. `git mv background.js platform/background.ts`.
  2. Update `build.mjs` ENTRIES entry and anything else referencing
     `background.js` (manifest's `service_worker` path is the big one).
  3. Convert to strict `tsconfig.strict.json` (it imports `lib/keys.ts`,
     `di/register-background.ts`, services — all already TS; the router body
     should need very little typing work).
  4. Update `manifest.json` `background.service_worker`.
- **Risk:** the manifest path and the build entry must move together, or the
  extension loads with no service worker and PING/COUNT/RUN all fail. Verify
  by loading `dist/` unpacked or by checking `manifest.json` after build.
- **Accept:** gate green; `dist/manifest.json` points at the new worker;
  `git status` shows no lingering `background.js`.

### 7b. `tools/viewer-dom-test.js` → `.ts`

- Goal: the last test file still in `.js` (it was listed in the Phase-4
  checklist). It imports the viewer's surfaces and drives the real DOM.
- **Steps**
  1. `git mv tools/viewer-dom-test.js tools/viewer-dom-test.ts`.
  2. `lib/` and the surfaces it imports are still `.js` — a `.ts` test file
     with `checkJs: false` will treat those as `any`; only convert the test
     harness itself, not what it imports.
  3. Add to a test-glob-safe location (it already matches `tools/*-test.*`).
- **Accept:** `npm test` still runs 222 tests.

### 7c. Fix the pre-existing lint warning

- `tools/viewer-dom-test.js:161` — `let hitTest = numTd;` is never reassigned
  (`prefer-const`). Change to `const`. This is a cosmetic fix that makes lint
  fully clean (0 errors, 0 warnings), which in turn makes the gate output
  easier to trust for every later phase.

---

## Phase 8 — `services/remote-bridge.ts` (page-side service proxies)

- Goal: components/surfaces stop hand-rolling `chrome.runtime.sendMessage`.
  Today `panel/panel.js` sends `MSG.count` / `MSG.run` by hand and listens for
  `MSG.progress` / `MSG.dataUpdated` (panel/panel.js:185, 262, 297, 326, 336).
  `settings/settings.js` broadcasts `MSG.dataUpdated` by hand too
  (settings/settings.js:68, 200).
- **Design** (architecture §4, "The background-only split"): remote-capable
  repositories cannot be constructed in pages (CSRF token + content-script
  relay live in the worker), so pages get remote-capable *interfaces*
  implemented over `chrome.runtime`:

  ```ts
  // services/remote-bridge.ts
  export class PullServiceBridge {
    static readonly deps = [] as const;
    run(opts) { return chrome.runtime.sendMessage({ type: MSG.run, ...opts }); }
    preview(opts) { return chrome.runtime.sendMessage({ type: MSG.count, ...opts }); }
    onProgress(fn) { ... }   // wraps chrome.runtime.onMessage, filters MSG.progress
    onDataUpdated(fn) { ... } // filters MSG.dataUpdated
  }
  ```

- **Steps**
  1. Write `services/remote-bridge.ts` with bridge classes implementing the
     shapes `panel/panel.js` currently consumes, plus a typed message
     listener helper.
  2. Register in `di/` (new tokens `PULL_SERVICE_BRIDGE`,
     `CONNECTION_SERVICE_BRIDGE` or similar) in the *page* registrations —
     they must NOT be in the background container.
  3. Repoint `surfaces/panel/index.ts` so the panel's run/preview handlers go
     through the bridge; simplify `panel/panel.js` accordingly.
  4. Same for `settings/settings.js`' `MSG.dataUpdated` broadcast.
- **Edge cases to preserve**
  - RUN is fire-and-forget; progress arrives by broadcast. The bridge's
    `run()` must not await a long-lived response channel.
  - The old `dataUpdated`/`progress` listeners are filtered by `MSG.type`;
    the bridge must attach exactly once (a page reload re-creates the
    context, but guard against double registration anyway).
  - The panel currently uses `chrome.runtime.getURL("viewer/viewer.html")`
    to open the viewer tab; that stays in the surface.
- **Tests:** `tools/remote-bridge-test.ts` against a fake `chrome.runtime`
  (like `viewer-dom-test`'s env fakes) — verify `run` sends the right message
  and `onDataUpdated` demultiplexes.
- **Accept:** gate green; grep shows no `chrome.runtime.sendMessage` left in
  `panel/` or `settings/`.
- **Rationale for ordering:** Phase 8 before Phase 9 because it touches the
  same files (`panel/panel.js`, `settings/settings.js`) that the TS migration
  will touch next — do the functional change first, then convert.

---

## Phase 9 — Finish the TypeScript migration (~6,150 lines)

The last big mechanical grind. Every file is converted the same way, in the
order below. Strictness is opt-in per file (base tsconfig stays
`strict: false`); add each converted file to `tsconfig.strict.json` and fix
strict errors.

**The migration recipe (from architecture §6):**

1. `git mv foo.js foo.ts`
2. Fix errors at the current (non-strict) level.
3. Rewrite `./sibling.js` import specifiers to `./sibling.ts` in **every**
   importer (Node does not rewrite `.js` → `.ts`; esbuild and tsc both accept
   `.ts`).
4. Add the file to `tsconfig.strict.json` (`include`) and fix strict errors.
5. Gate green, commit. (One commit per area, so each area is independently
   green and the diff is reviewable.)

**Ordering rationale:** `core/` first because it is pure, already covered by
standalone node tests, and has the most semantic weight (the four timeline
rules, report, SLA). The viewer, panel, and settings last because they have
the longest import chains — converting them pulls in their transitive deps, so
the leaf modules must be TS first.

### 9a. `core/` (12 files, ~1,973 lines)

- Order within the area: leaf modules with no deps first, then their
  importers. Rough order: `rowmerge`, `sntime`, `statechoices`, `names`,
  `msrchoices`, `querybuilder`, `journal`, `aiextract`, `slasummary`,
  `phase2`, `report`, `templatexml`.
- `templatexml.js` is the only one with a vendored-lib dependency
  (`fflate`) — it reads `globalThis.fflate`, and tests inject it via
  `setFflate()`. Keep that injection seam.
- Each file is `.js` imported by `viewer/js`-era modules and tests with
  explicit `.js` specifiers — after conversion, every importer (surfaces,
  tests, components) must switch to `.ts`.
- Tests already exist and cover these files 1:1
  (`phase2-unit-test.js`, `report-test.js`, `slasummary-test.js`,
  `querybuilder-test.js`, `ai-parse-test.js`, `template-export-test.js`,
  `sntime` via `tz-unit-test.js`, `journal`/`rowmerge`/`msrchoices`/
  `names` unit tests). The tests themselves stay `.js` unless noted —
  converting production files is sufficient; a test's `.js` works exactly the
  same over a `.ts` target.
- **Accept:** all `core/*.ts` on the strict include list; 0 type errors;
  test count unchanged (222).

### 9b. `lib/` (8 files, ~725 lines)

- `keys.ts` is already TS (Phase 0 pilot). Convert: `keys` is done;
  remaining = `markup`, `picklist`, `servicenow`, `storage`, `store`, `toast`,
  `tooltip`, `format`.
- **Do not** change the `lib/store.ts` / `lib/storage.ts` API while 18 viewer
  modules still consume them — convert, don't redesign. `store` has its own
  `tools/store-test.js`; keep it green.
- `servicenow.js` is the SN REST/encoding helper used by `data/datasource`
  and tests — its tests are already `.ts` in places; check the strict pass
  works before touching semantics.
- **Accept:** `lib/*.ts` strict; 0 errors; 222 tests.

### 9c. `content/content.js` — **stays classic JS**

- This is a deliberate exception, not a gap. The manifest declares the content
  script WITHOUT `"type":"module"`; an ESM bundle would break it
  (architecture §6). Leave `content/content.js` as plain JS with zero
  imports and document that in the plan/commit so nobody "fixes" it later.

### 9d. `surfaces/viewer/` (18 files; ~2,722 lines)

- Order: the six `init*()` wiring modules and their state modules convert
  last; convert the leaf helpers first:
  `grid-data`, `config-state`, `paste`, `shared`, `clipboard`, `exporter`,
  `activity`, `summary`, `selection`, `ticketpop`, `editors`, then
  `toolbar`, `dialogs`, `grid`, `interactions`, `cols`, `core`, `store`.
- **Watch-outs (from Phase 6's record)**
  - The init order (`summary → grid → cols → dialogs → toolbar →
    interactions`) is real and load-bearing; converting a module must not
    change its behaviour. Conversion means adding types, not reordering or
    folding spin `init*` bodies in.
  - `dialogs.js`' `mapModal`/`configModal`/`ciModal` are `let` assigned in
    `initDialogs()` and re-exported as live bindings — a `.ts` conversion must
    type them as `Modal | null` (or use a definite-assignment assertion) and
    must not switch the pattern to const snapshots.
  - The grid's `fmtInstant` is passed INTO `buildReport` (SLA coupling); types
    should make that explicit, not loosen it.
  - `$("tbl").tBodies[0]` etc. — DOM access in these modules means the DOM
    types (`HTMLElement`, `MouseEvent`…) are the bulk of the work.
- **Accept:** the 31 viewer DOM tests stay green after each conversion commit
  (they are the net).

### 9e. `panel/panel.js` + `settings/settings.js` (570 lines)

- Both pick up `chrome.runtime` usage (goes through the Phase-8 bridge by now),
  DOM event wiring, and `lib/*` calls.
- They are bootstrap-ish but contain real handlers (preview/run handlers,
  the viewer-tab opener, backup/import/clear-cache). Convert, don't rewrite —
  unless a Phase-8 bridge removal left an obvious stub.
- **Accept:** panel-components + settings-chips tests stay green;
  `npm run dev` produces a working panel/settings page.

### 9f. `platform/background.ts` (from 7a) revisit after viewer conversion

- If `background.js` was converted in Phase 7a, re-check it after the viewer
  modules shift — the worker imports `services` and `data` only, so it should
  be unaffected, but re-run the gate.

**Final acceptance for Phase 9:** the only `.js` left in the source tree is
`content/content.js` (the deliberate exception) and the `.js` test files under
`tools/`. `tsconfig.strict.json` includes every migrated file. Gate green.

---

## Phase 10 — Extract the last services (viewer business logic → `services/`)

- Goal: architecture §5 names six services (`pull · timeline · report ·
  export · extract · connection`); four exist. The remaining logic lives in
  the viewer page modules. Extract it into services the same "layer in place,
  move last" way the migration used.
- **Hard constraint (do not regress):** export bytes are built in the viewer
  PAGE (Blob + `chrome.downloads.download`); the worker never touches XLSX.
  An `export-service` must still run in the page — a service is just a class,
  so a page-imported service is fine. It must not move the byte-building into
  the background.

### 10a. `report-service.ts`

- What moves: `buildReport` usage (SLA derivation), SLA-summary table building
  (`buildSlaSummaryRows`), the `fmtInstant` normalisation hand-off.
- Currently spread across `surfaces/viewer/clipboard.js`, `summary.js`,
  `exporter.js`, `grid.js`. `core/report.js` and `core/slasummary.js` already
  hold the pure computation — a report service wraps them (normalise dates,
  pick SLA columns, format via the grid's `fmtInstant`) without touching the
  pure core.
- **Accept:** viewer behaviour identical; new `tools/report-service-test.ts`
  pins the fmtInstant→SLA coupling so a non-identity formatter changes derived
  results on purpose.

### 10b. `export-service.ts`

- What moves: the template patch (`core/templatexml.js` + cell-map), the
  per-CI-group split/TSV build, the filled-filename construction — the parts
  of `surfaces/viewer/exporter.js`, `clipboard.js`, `toolbar.js` that do
  work rather than DOM.
- The `MapDialog`/config UI stays in components; only the computation moves.
- **Accept:** `dist/` export still produces the same workbook bytes (the
  template-export tests exist and must not change).

### 10c. `extract-service.ts`

- What moves: `autoParse` (closure-note heuristic, in `grid.js` /
  `core/aiextract.js`) and journal/activity-notes parsing that lives in
  viewer modules. Thin wrapper over `core/aiextract.js`.
- **Accept:** extraction identical; `ai-parse-test` and activity tests stay
  green.

### 10d. `timeline-service.ts`

- The four rules live in `core/phase2.js` already; `pull-service.ts` already
  wires them for pipeline runs. Confirm whether a separate timeline service
  earns its place (it would serve the viewer's per-ticket timeline view). If
  the viewer's `activity.js`/`ticketpop.js` timeline display is still
  by-hand, extract that; otherwise mark 10d done-by-route and record why in
  the plan.

### Order within Phase 10

`extract` (smallest, safest) → `report` → `export` → `timeline` (route
decision). Each as its own commit with the gate green.

---

## Phase 11 — Feature backlog (AGENTS.md "Known Limits / Roadmap")

All four features are independent; pick per priority. Each one is a normal
feature branch: plan → implement → focused tests → gate green → review.

### 11a. Resume-from-checkpoint for huge pulls

- Problem: a large export can re-pull the same tickets from scratch if the
  user's tab dies mid-run. The pull pipeline already persists dataset + run
  state (`dataset`, `run-state` repositories); a checkpoint is the missing
  piece.
- Work: persist per-page progress in `run-state-repository`; on restart,
  ask (in the panel) whether to resume from the last completed page instead of
  re-fetching; wire the resume path through `PullService`.
- Care: freshness rules in `ticket-repository`/`timeline-repository` still
  apply — a checkpoint must not outlive the TTLs; a stale checkpoint offers
  the fresh path anyway.
- Accept: killing a run and resuming skips already-fetched pages; progress
  bar reflects the checkpoint.

### 11b. Derived duration columns

**Status: Done (Phase 11b).** `core/durations.ts` `computeDurations` derives
assign→ackn, assign→resolve (from `resolvedAtRaw`) and suspend total from the
four rules' UTC ISO timestamps; surfaced as viewer `dur:` columns and a
"Durations" group in the export column map. Default template layout unchanged.

- Problem: the workbook lacks easy "time in queue" / "handling time"
  durations.
- Work: derive `assign→ackn`, `assign→resolve`, `suspend` total on the
  timeline in `core/phase2.js` (or a new `core/durations.js`), surface as
  viewer columns + export fields (via the column map).
- Care: durations are a **derived** datum — compute from the four rules'
  timestamps, never from raw datetimes in the report (keeps the TZ contract
  single-sourced).

### 11c. Work-notes text export

- Problem: work notes / close notes are captured but not exported
  (`workNotes`, `closeNotes` fields exist in tickets).
- Work: add a work-notes column or a second sheet with full-text notes;
  decide which; template surgery must add a sheet or column safely
  (the `calcChain.xml` / `fullCalcOnLoad` rule from AGENTS.md applies if
  formula rows shift).
- Care: notes can contain arbitrary text — the xlsx cell escape path
  (`templatexml.js`) must handle it; tests = `tools/template-export-test.js`
  extension.

### 11d. Additional tables (RITM, change)

- Work: extend the selectable table set beyond `incident` /
  `change_request` / `problem` / `sc_req_item` / `sc_task` (the panel already
  lists these) to RITM/change if any are missing; validate the four timeline
  rules' state labels against each table's `sys_choice` (AGENTS.md warns
  `sc_task` has no OOB "On Hold").
- Care: the four rules were designed on incident semantics — non-incident
  tables must either be pinned by tests against their own state maps or
  explicitly documented as best-effort. Any new table's labels become a
  `core/statechoices.js` concern.

---

## Phase 12 — Validation and hardening (ongoing / user tasks)

These can run in parallel with the phases above. Some require the live
extension and credentials, so they are user tasks with these exact steps.

### 12a. Manual smoke test (extension)

The refactors of the viewer dialogs (Phases 4d/4e) are the highest-value
manual check. Full flight: reload `dist/` (or `dev/`) at
`chrome://extensions` → refresh the ServiceNow tab → connect → preview count →
Run export. Then:

1. Export with auto-column-mapping first (default), then reassign a column
   in the mapping dialog, save, export again — confirm the saved map is used.
2. Open the CI-dialog, add a group, save; verify "Separate files" export
   produces one file per group.
3. Escape cascade: open the map dialog, press Escape → it closes; open it
   again, click in a grid cell editor, press Escape → the cell editor keeps
   it (grid), not the modal.
4. Copy/paste/copy-for-msr on a selection; Ctrl+C / Ctrl+V / Ctrl+Z.
5. Tab switching (`Ctrl+1` / `Ctrl+2` / `Ctrl+Tab`).
6. Grid: sort by column, hide a column, change widths → reload the viewer →
   settings persist.

### 12b. Live timezone check

```bash
TZ_INSTANCE=… TZ_USER=… TZ_PASS=… node tools/tz-live-check.js
```

Needs live ServiceNow credentials; it verifies rendered times against the
instance's display values. Not part of `npm test` (must stay offline), but
run it after any change touching `core/sntime.js`, `grid.js`/`fmtInstant`,
or timezone handling in Phase 9/10.

### 12c. Component-test coverage audit

The migration repeatedly proved the end-to-end viewer DOM test does **not**
validate individual components (four distinct bugs in Phases 4b–4e slipped
past it). Record which components have focused tests today and which do not,
then close the gaps:

| Component | Focused tests? |
|---|---|
| ConditionBuilder, FilterSetList, ProgressCard, LogCard (`panel-components-test.ts`) | yes |
| ChipList (`settings-chips-test.js`) | yes |
| SearchPicker | yes |
| DataGrid | yes |
| Modal + CiDialog | yes |
| MapDialog | yes |
| Component base (`component.ts`) — build/patch/super-ordering traps | **no — write `component-test.ts`** |

---

## Deferred decisions (revisit before starting the phase they gate)

| Decision | Gated phase | Current answer |
|---|---|---|
| Is a standalone `timeline-service` worth it, or is the `phase2` + `pull-service` wiring enough? | 10d | **Settled:** done-by-route (Phase 10d). Rules live in `core/phase2` wired by `pull-service`; the viewer's activity pane is DOM rendering only and stays in a surface |
| Which format for work-notes export (extra column vs. extra sheet)? | 11c | Ask when starting 11c |
| Should features (11) precede finishing the migration (9–10)? | before 11 | No — finishing structure first keeps the feature branches small |
| `content/content.js`: keep classic JS permanently? | 9c | Yes — manifest constraint; re-evaluate only if the manifest gains `"type":"module"` |

---

## How to run the remaining work

1. Each phase is its own commit (or commit per area within a phase).
2. Every commit is individually green under the gate.
3. Update `docs/migration-plan.md` (status) and `AGENTS.md` (facts) as each
   phase completes — the same discipline the migration used.
4. Merge into local `main` when a phase is done and reviewed (no push unless
   asked).
5. When all of Phases 7–11 are done, strip Phase 12 items out of this doc
   into their own living checklist, and reduce this roadmap to "done" with a
   pointer to the known-limits section of AGENTS.md.
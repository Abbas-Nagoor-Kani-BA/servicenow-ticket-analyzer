# Migration Plan: layered architecture (OOP + DI + TypeScript)

Branch: **`refactor/layered-architecture`** (branched off `feat/maintainability-refactor`,
23 commits ahead of `main`).

Reference: [`docs/layered-architecture.md`](./layered-architecture.md) — the target
architecture. This file is the **status tracker** for getting there.

Supersedes `issues/001-readability-maintainability.md` (its Priority 1-6 items are
all complete; its pending items are folded in below). Both old docs are deleted in
Phase 5.

## Gate (run after every phase)

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

`npm test` is `node --test "tools/*-test.*"` — a **glob**, not a directory.
`node --test tools` does not work in Node 25 (it tries to load the directory as a
module).

Baseline before starting: typecheck **0 errors**, lint **1 warning**
(`prefer-const` in `tools/viewer-dom-test.js`), 93 tests passing, build OK.

---

## Phase 0 — Toolchain pilot — COMPLETE

**Goal:** prove the TypeScript toolchain works end-to-end before committing to it.
**Result: gate green — typecheck 0 errors, lint 0 errors, 93/93 tests, build OK.**

- [x] Create branch `refactor/layered-architecture`
- [x] Write `docs/layered-architecture.md`
- [x] Write `docs/migration-plan.md` (this file)
- [x] Add `tsconfig.json` — base config, `allowJs` + `checkJs`, `noEmit`, `strict: false`
- [x] Add `tsconfig.strict.json` — extends base, `strict: true`, explicit `include` list
- [x] Delete `tsconfig.check.json`; `npm run typecheck` now runs both new configs
- [x] Add `typescript-eslint` devDependency + `**/*.ts` + `**/*.d.ts` blocks in `eslint.config.mjs`
- [x] Create `di/token.ts` — branded `Token<T>` type + `token()` helper
- [x] Create `di/container.ts` — `registerValue` / `register` / `registerClass` / `resolve` / `child`
- [x] **Pilot migration:** `lib/keys.js` → `lib/keys.ts`, 9 importers updated to `"./keys.ts"`
- [x] Add `tools/di-test.ts` — 7 tests: resolve, auto-wiring, fakes, singleton vs transient, child override
- [x] Rename `tools/tz-live-test.js` → `tools/tz-live-check.js` (needs live credentials;
      it was the only red suite. `AGENTS.md` reference updated.)

### Pilot risk register — resolved

| Risk | Outcome |
|---|---|
| Node won't resolve `.ts` import specifiers | **Fine.** Explicit `.ts` extensions work in tsc, esbuild, and Node. |
| esbuild won't bundle a `.ts` file | **Fine.** `lib/keys.ts` is inlined into all four bundles; no `build.mjs` change needed until an *entry* is renamed. |
| `@types/chrome` conflicts with `types/global.d.ts` | **Fine.** Kept `"types": []`; the ambient `var chrome: any` wins. |
| `checkJs` noise from unmigrated files | **Fine.** Base config stays `strict: false`; strictness is opt-in per file. |

### Two real bugs the pilot caught

1. **Parameter properties hard-fail at runtime.** `constructor(private readonly x: T)`
   throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` under Node's strip-only mode — and it
   was in the pilot's *own* test file. Now banned by
   `@typescript-eslint/parameter-properties` (renamed from `no-parameter-properties`
   in typescript-eslint v8).
2. **Child container overrides were silently ignored.** `Container.resolve()` walked
   up to the ancestor owning a registration, then resolved that service's
   dependencies from the *ancestor* — so `child().registerValue(...)` had no effect
   on services registered in the root. Fixed by threading the container resolution
   *started* from (`root`) through to each provider. Covered by the
   "child inherits parent registrations and can override them" test. This mattered
   because the whole test-with-fakes story depends on it.

---

## Phase 1b — Remote repositories — COMPLETE

**Result: gate green — typecheck 0 errors, lint 0 errors, 119/119 tests, build OK.**

- [x] `data/idb.ts` — IndexedDB wrapper (`createIdbDatabase`) + `createMemoryDatabase` + `getDefaultDatabase`
- [x] `data/datasource/sn-transport.ts` — `smartFetch`, `resolveToken`, `findServiceNowTab`, cookie/page token probes (moved out of `background.js`)
- [x] `data/datasource/sn-remote.ts` — `SnRemote` interface, `ServiceNowRemote` adapter, `FakeSnRemote`
- [x] `data/repositories/ticket-repository.ts` — cache-aside moved out of `background.js:254-266`
- [x] `data/repositories/timeline-repository.ts` — cache-aside moved out of `background.js:277-300`
- [x] `di/register-background.ts` — `createBackgroundContainer()`; `SN_REMOTE` registered per run on a `child()`
- [x] `background.js` — `makeClient` replaced by `makeRunContainer`; `processFilterSet` / `fetchTimelines` now take repositories
- [x] Delete `lib/cache.js` (superseded); `settings.js` clears via `getDefaultDatabase()`
- [x] Delete `tools/cache-test.js` — its assertions were ported into `tools/pull-cache-test.ts`
- [x] Add `fake-indexeddb`; `tools/idb-test.ts` covers the real IndexedDB path

### Notes

- No `data/repositories/fakes/` directory was needed. `createMemoryKeyValueStore()`
  and `createMemoryDatabase()` cover the local repositories, and `FakeSnRemote`
  covers the remote — so no test mocks an extension API at all.
- `TimelineRepository.getMany` returns `{ events, reused, fetched }` rather than a
  bare Map: the caller needs the reuse count for the progress line, and only the
  repository knows which tickets it skipped.
- `tsconfig.strict.json` sets `checkJs: false`. Without it the strict pass follows
  imports into un-migrated `.js` and reports `noImplicitAny` errors from files that
  have not been migrated yet. Strictness is opt-in per **TypeScript** file.

### A real bug the IndexedDB tests caught

`createIdbDatabase`'s transaction helper assigned `onsuccess` on whatever request
the callback returned. For `deleteWhere` that clobbered the cursor's own
`onsuccess`, so the cursor never advanced: **nothing was ever deleted and
`purgeExpired` silently no-oped.** The in-memory database could not catch this.
Verified by reintroducing the fix's inverse — 3 of the 8 new tests fail without it.

---

## Phase 1a — Local repositories — COMPLETE

**Result: gate green — 102/102 tests.**

- [x] `di/tokens.ts` — central token registry
- [x] `data/key-value-store.ts` + `data/chrome-key-value-store.ts`
- [x] `data/repositories/` — settings, dataset, run-state, export-config, viewer-prefs, template, filter-list
- [x] `tools/repository-test.ts` — 9 tests

**Goal:** establish the I/O boundary. Highest value, zero UI risk.

- [ ] `di/tokens.ts` — central token registry (deferred from Phase 0: tokens are typed
      by the repository interfaces, which do not exist yet)
- [ ] `data/idb.ts` — extract `openDb` / `idbReq` / `purgeExpired` from `lib/cache.js`
- [ ] `data/repositories/settings-repository.ts` — `pluginSettings`
- [ ] `data/repositories/dataset-repository.ts` — `lastData` + change notification
- [ ] `data/repositories/run-state-repository.ts` — `lastRun`
- [ ] `data/repositories/export-config-repository.ts` — `ciSplit`, `exportColMap`, `msrLists`, `viewerColWidths`, `viewerHiddenCols`, `viewerSel`
- [ ] `data/repositories/template-repository.ts` — `snXlsxTemplate`
- [ ] `data/repositories/filter-list-repository.ts` — `snFilterList`
- [ ] `data/repositories/ticket-repository.ts` — cache-aside moved out of `background.js:254-266`
- [ ] `data/repositories/timeline-repository.ts` — cache-aside moved out of `background.js:277-300`
- [ ] `data/repositories/fakes/*.ts` — in-memory implementations of every interface
- [ ] `data/datasource/sn-transport.ts` — `smartFetch` + `resolveToken` + `findServiceNowTab` (background only)
- [ ] `data/datasource/servicenow-remote.ts` — move `lib/servicenow.js`
- [ ] Tests: `tools/repository-test.ts`, `tools/cache-test.ts` against fakes
- [ ] Closes: `issues/001` Priority 7 (`lib/cache.js` has no coverage)

---

## Phase 2 — Services — COMPLETE

**Result: gate green — typecheck 0 errors, lint 0 errors, 127/127 tests, build OK.**
**`background.js` went from 358 lines to 129.**

- [x] `services/pull-service.ts` — `resolveRunSettings`, `scopeGroups`, limit enforcement,
      per-table `sys_id` union, timeline rules wiring, `mergeRows`, persist + broadcast
- [x] `services/queue-scope.ts` — queue scoping shared by preview and pull
- [x] `services/connection-service.ts` — preview count
- [x] `background.js` reduced to a message router (PING / COUNT / RUN)
- [x] `tools/pull-service-test.ts` — 8 tests driving the real `PullService` against fakes
- [x] Closes: ARCH-002 (`globalThis.Analysis` is now confined to the router)

### Notes

- `SnRemoteFactory` / `RunScopeFactory` exist because `SN_REMOTE` is bound to one
  instance URL and therefore belongs to a single run. `RUN_SCOPE_FACTORY` opens a
  child container per run and returns the two repositories wired to it.
- `scopeGroups` was extracted into `services/queue-scope.ts` rather than
  duplicated: `handleCount` used to throw on missing/comma-bearing queue names
  and the first cut of `ConnectionService` silently filtered them. A preview that
  counts something different from what the pull fetches is worse than no preview,
  so both now call the same function.
- RUN is fire-and-forget, matching the old contract. Awaiting it would hold the
  response channel open for minutes; progress reaches the panel by broadcast.
- `services/remote-bridge.ts` (page-side proxies) is deferred to Phase 4, when the
  panel and viewer actually get composition roots. Nothing needs it yet.

---

## Phase 2 — Services (background becomes a router) — see above

- [ ] `services/pull-service.ts` — `resolveRunSettings`, `scopeGroups`, limit enforcement, per-table `sys_id` union, `mergeRows`, persist + broadcast
- [ ] `services/timeline-service.ts` — the four timeline rules wiring, state-map selection
- [ ] `services/connection-service.ts` — PING / COUNT, instance detection
- [ ] `services/report-service.ts` — report + SLA summary derivation
- [ ] `services/export-service.ts` — xlsx fill, CI-split grouping, TSV build
- [ ] `services/extract-service.ts` — closure-note heuristic (`autoParse`)
- [ ] `services/remote-bridge.ts` — page-side proxies over `chrome.runtime`
- [ ] `background.js` reduced to a message router (~80 lines)
- [ ] Test: `tools/pull-service-test.ts` with fake repositories
- [ ] Closes: ARCH-002 (`globalThis.Analysis` global) — becomes a clean import

---

## Phase 3a — Panel components — COMPLETE

**Result: gate green — typecheck 0 errors, lint 0 errors, 139/139 tests, build OK.**
**`panel/panel.js` went from 671 lines to 445; 172 lines of cond-row machinery deleted.**

- [x] `components/component.ts` — abstract base: `build()` once, `patch()` always
- [x] `components/log-card.ts` — replaces `panel/log.js` (deleted)
- [x] `components/progress-card.ts` — bar/stage/counter, percentage derived from stage + counts
- [x] `components/condition-builder.ts` — replaces `renderCondRows` + `collectConditions()`
- [x] `tools/panel-components-test.ts` — 12 DOM tests, including focus preservation

### The rule that got found twice

**A subclass cannot use instance fields or `#private` methods from `build()` or
the first `patch()`.** Both are installed on the instance only *after* `super()`
returns, but the base constructor calls `build()`. Two symptoms, both hit:

- a subclass field reads as `undefined` while the component builds itself
- calling a `#private` method throws
  `TypeError: Receiver must be an instance of class ...`
  (this broke every `ConditionBuilder` test until the helpers were made
  `protected`, i.e. prototype methods)

`#private` is still fine for anything touched only after construction, such as
the teardown handler in `LogCard`. This is now documented in
`components/component.ts` rather than left to be rediscovered.

### Why the condition builder does not re-render on keystrokes

`patch()` compares row *shapes* (`join:field:op` per row), not values. Typing in
a value input mutates state and emits `change` so the query preview refreshes,
but never rebuilds the rows — a rebuild mid-keystroke would drop focus and the
caret. `tools/panel-components-test.ts` asserts `document.activeElement` is
still the input after two input events.

---

## Phase 3b — Filter list + panel composition root — COMPLETE

**Result: gate green — typecheck 0 errors, lint 0 errors, 145/145 tests, build OK.**
**`panel/panel.js` went from 671 lines (pre-migration) to 364.**

- [x] `components/filter-set-list.ts` — owns the saved sets; persistence goes
      through `FilterListRepository`, never `localStorage`
- [x] `surfaces/panel/index.ts` — composition root: builds the container and the
      four components, injecting repositories via `deps`
- [x] `migrateLegacyFilterSets()` — one-time import from the old `localStorage`
      key, or a user's saved sets would vanish on first load after upgrading
- [x] `lib/statechoices.js` — added `snTableLabel()`; `SN_TABLE_LABELS[someString]`
      does not type-check (closed record, no index signature) and three files
      were each casting it locally

### Filter list rebuilds where the condition builder does not

`FilterSetList` rebuilds its rows on every change; `ConditionBuilder` does not.
That asymmetry is deliberate: filter rows contain no text inputs, so there is no
focus or caret to lose, and the list is short. The rule is "rebuild only when
rebuilding is free" — not "never rebuild".

### Remaining in panel.js

Instance url + connect, the raw-query box, generated-query preview, preview and
run handlers, and the viewer-tab opener. The file is a bootstrap plus those
handlers, and no longer touches condition or filter-list state directly.

### Deferred to Phase 4

`services/remote-bridge.ts` (page-side service proxies over `chrome.runtime`) —
the panel still sends `MSG.count` / `MSG.run` by hand. It becomes worthwhile
when the viewer and settings get their own composition roots.

---

## Phase 3 — Panel components (OOP) — see 3a and 3b above

Chosen first: highest confusion, lowest risk, no hard-won invariants live there.

- [ ] `components/component.ts` — the abstract base (§2 of the architecture doc)
- [ ] `components/condition-builder.ts` — replaces `panel.js:161-431`; kills `collectConditions()` (DOM-as-state)
- [ ] `components/filter-set-list.ts` — replaces `panel.js:191-245`
- [ ] `components/progress-card.ts` — progress bar, stage label, counter
- [ ] `components/log-card.ts` — moved from `panel/log.js`
- [ ] `surfaces/panel/container.ts` — composition root
- [ ] `panel/panel.js` → `panel/panel.ts`, bootstrap only

---

## Phase 4 — Settings, then viewer

- [ ] `components/chip-list.ts` — moved from `settings/chips.js` (already close to the pattern)
- [ ] Settings bootstrap as a composition root
- [ ] `components/search-picker.ts` — deduplicates DEDUP-005 (`70-editors` + `50-ticketpop`)
- [ ] `components/dialog.ts` + `ci-dialog` + `map-dialog` — from `viewer/js/25-dialogs.js`
- [ ] `components/data-grid.ts` — from `viewer/js/30-grid.js`; **keep the imperative fast paths**
- [ ] `components/summary-table.ts`, `components/activity-pane.ts`
- [ ] `tools/viewer-dom-test.js` → `.ts`; must stay green throughout
- [ ] Drop numeric `NN-` module prefixes once imports are one-directional

---

## Phase 5 — Restructure + documentation

- [ ] Move `analysis/` + pure `lib/*` → `core/`
- [ ] Move `background.js` → `platform/background.ts`; content script stays `content/content.js`
- [ ] Update `build.mjs` ENTRIES + `STATIC_COPY` for final paths
- [ ] **Delete `docs/architecture.md`** (superseded by `docs/layered-architecture.md`)
- [ ] **Delete `issues/001-readability-maintainability.md`** (tracking moves here)
- [ ] **Update `AGENTS.md`** — File Map, Critical Knowledge, Verification Commands
      for the new layout. Carry over verbatim: auth chain, four timeline rules,
      timezone contract, xlsx surgery, download path.
- [ ] Full gate + manual smoke test (reload → refresh SN tab → Connect → Preview → Run)

---

## Deferred decisions

| Decision | Status |
|---|---|
| Component style | Settled: **OOP classes** (not factory functions, not custom elements) |
| DI style | Settled: **constructor injection + branded tokens** (no decorators) |
| Directory restructure | Settled: **layer in place, move last** |
| Starting surface | Settled: **panel** |
| Old doc deletion | Settled: **Phase 5**, AGENTS.md updated last |
| TS toolchain | **Proven** by the Phase 0 pilot — no fallback needed |
| TS strictness ramp | Open: opt-in per file (current plan) vs. strict from the start |

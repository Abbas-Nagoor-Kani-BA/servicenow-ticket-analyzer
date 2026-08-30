# AGENTS.md

Instructions for AI coding agents working in this repository.

## Project Overview

Chrome extension (Manifest V3, Side Panel UI) that pulls incident tickets from a
ServiceNow instance via REST, extracts per-ticket queue timelines, and exports an
Excel (.xlsx) analysis workbook.

- Target instance: `https://dev385266.service-now.com` (developer instance, admin role)
- Auth model: reuses the user's browser login session. No API keys or Basic auth.
- Two-phase pipeline: Phase 1 = paginated ticket list; Phase 2 = audit-history timelines.

**The codebase is a layered architecture: `core/` → `data/` → `services/` →
`components/` → `surfaces/`, wired by a DI container in `di/`. Read
[`docs/layered-architecture.md`](docs/layered-architecture.md) before adding
code — it defines what each layer may and may not do.**

## Directory Map

```
core/        Pure domain. phase2 (the four timeline rules), report, slasummary,
             aiextract, querybuilder, sntime, statechoices, names, msrchoices,
             rowmerge, journal, templatexml.
             No DOM, no chrome.*, no I/O. Runs standalone in plain node.
data/        Everything that touches storage or the network.
  repositories/  ticket, timeline, settings, dataset, run-state, export-config,
                 viewer-prefs, template, filter-list, msr-lists
  datasource/    sn-transport (session auth), sn-remote (ServiceNow client)
  idb.ts, key-value-store.ts, chrome-key-value-store.ts
services/    Business logic: pull, connection, settings, queue-scope.
             No DOM. Depends on repositories, never on components.
components/  OOP UI units that own their state and their DOM:
             Component (base), Modal, DataGrid, SearchPicker, MapDialog,
             CiDialog, LogCard, ProgressCard, ConditionBuilder, FilterSetList,
             ChipList.
             Never touch chrome.*, indexedDB or fetch — call a service.
surfaces/    Composition roots: panel, settings. The only place that knows both
             the container and the components.
di/          Container, tokens, and the per-surface registration functions.
lib/         Platform and UI helpers: keys, storage, store, markup, picklist,
             servicenow, toast, tooltip, format.
viewer/      The data-view page (HTML only — viewer/viewer.html). Its modules
             live in surfaces/viewer/ below.
panel/, settings/, platform/ (service worker), content/
```

`surfaces/viewer/` is the viewer page's own composition root plus its modules
(`core`, `store`, `grid-data`, `cols`, `config-state`, `exporter`, `clipboard`,
`summary`, `paste`, `toolbar`, `dialogs`, `grid`, `selection`, `ticketpop`,
`activity`, `editors`, `shared`, `interactions`). `surfaces/viewer/index.ts`
calls each module's `init*()` in a fixed order and then boots. The modules still
own the data stores and the export pipeline; their UI lives in `components/`.

**Nothing binds DOM handlers at module scope.** Every module exports an
`init*()` and the composition root decides when it runs. Adding top-level
wiring to a viewer module re-introduces the invisible ordering this replaced.

### Layering rules

| Layer | May use | Must never |
|---|---|---|
| `core/` | only `core/` | `chrome.*`, `indexedDB`, `fetch`, DOM |
| `lib/` | `core/` | other layers |
| `data/` | `core/`, `lib/`, platform APIs | DOM, `services/`, `components/` |
| `services/` | `core/`, `lib/`, `data/` | DOM, `components/` |
| `components/` | `core/`, `lib/`, services via `deps` | repositories, `chrome.*`, `indexedDB`, `fetch` |
| `surfaces/` | everything | containing business logic |

Dependency direction is strictly downward.

## Component contract

Components extend `components/component.ts`. Two rules are load-bearing and both
were found the hard way — see the file's own documentation:

- **`build()` runs once; `patch()` runs on every state change.** A full rebuild
  per change destroys input focus and caret position. The condition builder
  compares row *shapes*, not values, so typing never re-renders its rows.
- **Subclasses must not use instance fields or `#private` methods from `build()`
  or the first `patch()`.** Both are installed on the instance only after
  `super()` returns, but the base constructor calls `build()`. A field reads as
  `undefined`; a `#private` method call throws
  `TypeError: Receiver must be an instance of class ...`. Helpers called during
  build must be `protected` prototype methods.

Elements that are siblings rather than children (the log modal, `#count`,
`#slaBar`, the add-condition button) arrive through `deps`, not `q()`.

## DI container

`di/token.ts` gives branded string tokens; `di/tokens.ts` is the registry.
Classes take dependencies as constructor arguments and declare them as a
`static deps` array of tokens — esbuild cannot emit decorator metadata, so
reflection-based DI is unavailable.

No decorators, no service locator (except `RUN_SCOPE_FACTORY`, which exists
because `SN_REMOTE` is bound to one instance URL per pull).

Singletons are cached **per container**, so a `child()` can override a
dependency — that is what makes tests able to inject fakes. See
`di/container.ts`.

## Critical Knowledge (do not regress)

### Authentication chain (`data/datasource/sn-transport.ts`)

Requests MUST go through this order:

1. Find an open tab matching the instance origin. **No tab → fail fast with a
   clear message** (session auth is impossible without it).
2. Get CSRF token: try `g_ck` cookie via `chrome.cookies`; if absent, inject a
   MAIN-world script reading the page global `g_ck`.
3. Relay through the tab's content script (same-origin fetch, cookies first-party).
4. Direct `fetch` from the service worker is last-resort only.

Why this shape (hard-won):
- MV3 service-worker fetches are cross-site: third-party cookie blocking breaks session cookies.
- Content scripts run in an **isolated world** — they CANNOT see page globals like `g_ck`.
- On current releases there is no reliable `g_ck` cookie; the token lives as a JS variable in page context.
- ServiceNow rejects session-authenticated API calls missing `X-UserToken` with 401.
- Users must refresh their ServiceNow tab after reloading the extension, or the content script won't exist yet.

### No-permission design (hardcoded scope)

The default flow makes ZERO metadata lookups: no `sys_choice`, `sys_user_group`,
`sys_user_grmember`, or `sys_user` reads — no such resolver methods exist. Some
users lack permission for those tables, so all scoping data is hardcoded in
settings instead:

- Queues and team members = plain NAME strings in `pluginSettings.defaults`
  (one name per line in the options page; matching is case-insensitive).
- State/priority labels come from `core/statechoices.js` OOB maps.

Only the selected ticket table plus the per-ticket activity feed
(`list_history.do`) are read during pulls. COUNT/RUN are the only server
operations; the panel's Connect is local-only validation.

### The four timeline rules (business requirements — never change semantics without asking)

Computed in `core/phase2.js` from timeline events (`assignment_group`,
`assigned_to`, `state`), replayed in chronological order:

1. **assignTime** — LAST time `assignment_group` changed TO the target queue.
   Born-in-queue fallback: if NO group-change events exist but the ticket's
   CURRENT group == queue, assignTime = opened_at. assignTime is CLAMPED to
   never precede opened_at; the clamp does not affect ackn eligibility. Each
   ticket is measured against ITS OWN current group, and ackn checks membership
   of that queue's member set (the flat configured team-member list applied to
   every selected queue).
2. **acknTime** — LAST time `assigned_to` became a member of the queue's team,
   counted ONLY if it occurs at/after the latest queue-entry event.
3. **suspendTime** — FIRST transition INTO "On Hold" while current group == queue.
   State labels come from `core/statechoices.js`. Feed events carry DISPLAY
   LABELS ("On Hold"); legacy sys_audit rows carried raw values ("3") — both are
   accepted.
4. **resumeTime** — FIRST post-suspend transition to "In Progress"; if none, fall
   back to first post-suspend "Resolved". Null if never resumed.

On Hold transitions while assigned elsewhere do NOT count. Group changes reset
queue context.

### Performance constraints

- Phase 2 reads the activity feed PER TICKET — no batching exists; keep per-ticket progress reporting.
- Table API pages of 1000. Exports can reach Excel's 1,048,576-row ceiling.
- Keep the ServiceNow tab open during exports (relay + node affinity).

### Timezone contract

- ServiceNow REST raw datetimes are UTC; `parseUtc()` appends Z before parsing.
- All displayed times must follow the INSTANCE clock, never the browser. The
  only reliable oracle is SN's own display/raw pair per record.
- The viewer's `fmtInstant(v, row)` resolves each row's OWN offset from its
  openedAt display/raw pair, so rows spanning DST seasons stay correct.
- Display values are parsed format-tolerantly (`parseSnDisplayMs`).
- Empty timeline events on a run where tickets clearly HAVE history usually
  means the activity feed returned nothing for them; the viewer shows a warning
  banner.
- **The grid passes `fmtInstant` INTO `buildReport`, which uses it to normalise
  dates. A non-identity formatter therefore changes derived SLA results, not
  just displayed text.**

See `docs/timeline.md` and `docs/timeline-formats.md`.

### Download path (MV3 constraint)

The service worker never touches XLSX bytes. The viewer page loads the user's
cached template, patches only the target sheet's XML (fflate zip surgery), and
downloads via Blob + `chrome.downloads.download`. Extension pages have
`URL.createObjectURL`; workers do not. Never move export building back into the
background, and never regenerate the workbook with a spreadsheet library
(ExcelJS/SheetJS re-serialization corrupts formatted templates).

### Export sheet lookup

Sheet lookup normalizes names (`_`/space/case-insensitive, exact then loose) and
NEVER silently falls back to another sheet — a wrong-sheet fill once emptied a
user's report. If formula rows get deleted, strip `xl/calcChain.xml` and set
`fullCalcOnLoad="1"` on `<calcPr>`, or Excel raises its repair dialog.

## Verification Commands

There is no bundler or package manager for tests. Verify with node after every
change:

```bash
node --check platform/background.ts core/*.ts lib/*.ts surfaces/viewer/*.js panel/*.js settings/settings.js content/content.js surfaces/viewer/index.ts && \
node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"
```

`npm run typecheck` (tsconfig.json + tsconfig.strict.json) is meaningful — keep
it at 0 errors; `npm run lint` likewise. `npm test` runs the offline suites (the
glob is required; `node --test tools` does not work). See
[`docs/migration-plan.md`](docs/migration-plan.md) for the current gate and what
each phase covered.

Full gate:

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Pure modules in `core/` are ES modules and run standalone in plain node, e.g.:

```js
import { extractTimelines } from './core/phase2.js';
```

Regression suites (`npm test` runs all of them):

| Suite | Covers |
|---|---|
| `phase2-unit-test.js` | the four timeline rules |
| `querybuilder-test.js` | encoded-query construction |
| `report-test.js`, `slasummary-test.js` | report and SLA derivation |
| `ai-parse-test.js` | closure-note regex extraction |
| `activity-client-test.js`, `activity-parse-test.js` | activity feed source and parsing |
| `cache-test.js` — **superseded by** `pull-cache-test.ts` | cache policy, now tested through the repositories |
| `idb-test.ts` | the real IndexedDB path via fake-indexeddb |
| `di-test.ts`, `repository-test.ts`, `pull-service-test.ts`, `settings-service-test.ts` | DI and services against fakes |
| `panel-components-test.ts`, `data-grid-test.ts`, `search-picker-test.ts`, `modal-test.ts`, `map-dialog-test.ts`, `settings-chips-test.js` | components |
| `viewer-dom-test.js` | end-to-end viewer flow (happy-dom) |

Manual test loop (user performs): reload extension at `chrome://extensions`
→ refresh the ServiceNow tab → Connect → Preview count → Run export.

`TZ_INSTANCE=… TZ_USER=… TZ_PASS=… node tools/tz-live-check.js` verifies
rendered times against SN's display values. It needs live credentials, which is
why it is a `-check` and not a `-test` — `npm test` must stay offline.

### Builds (loading the repo root unpacked NO LONGER works)

Sources include `.ts` files, which Chrome cannot execute as modules — `.ts` is
served with a non-JavaScript MIME type and the type annotations are not valid
JS. Always load a **built** folder:

- `npm run dev` (or `npm run watch`) → rebuilds `dev/` on change. Load `dev/`
  unpacked. This is the development loop.
- `npm run build` → `dist/` (bundled, mirrors repo layout). Load `dist/`
  unpacked to smoke-test the release shape.
- `npm run zip` → packs `dist/`.

`dev/` and `dist/` are both gitignored. Watch mode must never write into the
repo root: the esbuild entries *are* the sources, so bundling to ROOT would
overwrite `panel/panel.js` and friends with their own output. `build.mjs`
refuses to build into ROOT, and watch mode targets `dev/`.

## Conventions

- No code comments unless asked; no emojis in output files.
- ES2022 max (MV3 service workers): private `#methods`, top-level `await` avoided.
- **ES modules everywhere**: every `.js` is an ES module (`package.json`
  `"type":"module"`; service worker declared with `"type":"module"`; pages load
  a single `<script type="module">` entry). No IIFE/globalThis attaches, no
  `importScripts`, no `require()`.
- `.ts` files are type-checked, not compiled — esbuild strips the types.
  Import specifiers use **explicit `.ts`** because Node does not rewrite
  `.js` → `.ts`.
- **Avoid `enum`, `namespace` and parameter properties.** Node's type stripping
  cannot transform them; they need `--experimental-transform-types`. ESLint
  bans them.
- Two tsconfigs: the base checks everything non-strictly; `tsconfig.strict.json`
  checks an explicit, growing list of migrated files strictly and sets
  `checkJs: false` so it cannot leak into un-migrated JS.
- Mutable shared state is owned by exactly one module and exposed via accessor
  functions, never via reassigned imports.
- Vendored UMD libs (fflate) stay classic: loaded via `<script>` before the
  page's module entry (pages read `globalThis.fflate`), or via
  `lib/vendor/fflate.cjs` createRequire shim inside node tests (`setFflate()`
  injection for `core/templatexml.js`).
- All user-facing strings in English; timestamps ISO 8601.
- Never log or store full token values — prefix only (first 8 chars) in diagnostics.
- Instance URL comes from user input/storage; always validate `https://`.

## Testing notes learned the hard way

**The viewer DOM test cannot validate a component's own contract.** It drives
the grid through `30-grid.js`, and it stayed green through three separate
component-level bugs: an unseeded picker list, three width/state bugs in
`DataGrid`, and Escape silently not closing two of four overlays. Every
component needs its own test; end-to-end coverage is not enough.

## Known Limits / Roadmap

- Ticket type is selectable in the panel (incident, change_request, problem,
  sc_req_item, sc_task); the four timeline rules were designed on incident
  semantics — validate state labels per table before trusting results elsewhere.
  sc_task has no OOB "On Hold" state: suspend/resume stay null unless the label
  exists in that table's sys_choice list. Closed-state date filtering triggers on
  any label starting with "close" (Closed Complete/Incomplete/Skipped).
- Closed-state filtering uses `closed_at` BETWEEN dates; the date block appears
  only when the selected state's label is "Closed" and both dates are required.
- Audit availability depends on instance retention/roles; tickets missing audit
  rows are reported in the done-message count.
- Remaining migration work is tracked in `docs/migration-plan.md`; the forward
  plan (what is still left after Phase 6, in order) is `docs/roadmap.md`.
- Possible future work: resume-from-checkpoint for huge pulls, derived duration
  columns, work-notes text export, additional tables (RITM, change).

## Docs

| File | Purpose |
|---|---|
| `docs/layered-architecture.md` | The target architecture. Start here. |
| `docs/migration-plan.md` | Phase-by-phase status and the gate. |
| `docs/roadmap.md` | What remains after Phase 6, in order: leftovers, TS migration, services, features. |
| `docs/invariants.md` | ADR-style record of non-obvious rules. |
| `docs/timeline.md`, `docs/timeline-formats.md` | Timeline and SLA computation, datetime formats. |
| `docs/filtering.md` | How filters become an encoded query. |
| `docs/resolved/` | Fixed-bug records, kept for the reasoning. |

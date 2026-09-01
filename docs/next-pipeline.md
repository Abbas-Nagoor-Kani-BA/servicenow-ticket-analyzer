# Next Pipeline (parked features and validation)

Standing note of the work left in the pipeline. Detailed problem/acceptance
text lives in `docs/roadmap.md` — this file is the running status list.

## Done so far

- Phases 0-8, 9a-9f (layered-architecture migration, `.js` -> `.ts`, viewer
  composition root) — see `docs/migration-plan.md` Roadmap progress.
- Phase 10a-10d (extract the viewer services: report, export, extract;
  timeline route decision = done-by-route).
- Phase 11b (derived duration columns, `core/durations.ts`).
- Calclens attention flags (`core/attention.ts`): row-level "needs attention"
  markers when Calclens is ON.

Gate after every change: `npm run typecheck && npm run lint && npm test && npm run build`.

## Phase 11 — feature backlog (each a normal feature branch, gate green)

| Item | Status | Key points |
|---|---|---|
| 11a Resume-from-checkpoint | not started | Persist per-page progress in `run-state-repository`; panel asks to resume instead of re-fetching; wire through `PullService`. Care: checkpoint must not outlive the ticket/timeline TTLs — a stale checkpoint offers the fresh path anyway. Largest item; touches repositories + PullService + panel. |
| 11b Derived durations | **Done** | `core/durations.ts`; `dur:` viewer columns; "Durations" export group. |
| 11c Work-notes text export | pending decision | Format question gates it: extra column vs. second sheet. Care: arbitrary note text must go through `templatexml.ts`'s escape path; `calcChain.xml`/`fullCalcOnLoad` rule applies if formula rows shift. |
| 11d Additional tables | not started | Extend the selectable set beyond incident/change_request/problem/sc_req_item/sc_task; validate the four rules' state labels per table (`sc_task` has no OOB "On Hold"). Non-incident labels are a `core/statechoices.ts` concern; pin by tests or document best-effort. |

## Phase 12 — validation / hardening (user tasks, run in parallel)

| Item | Status | How |
|---|---|---|
| 12a Manual smoke test | pending | Reload `dist/` at `chrome://extensions`, refresh the ServiceNow tab, Connect, Preview count, Run export. Exact checklist (map dialog, CI-split, Escape cascade, tabs, grid persistence, Calclens drawer editing) in `docs/roadmap.md`. |
| 12b Live timezone check | pending | `TZ_INSTANCE=… TZ_USER=… TZ_PASS=… node tools/tz-live-check.js` (needs live credentials; run after anything touching timezone). |
| 12c Component-test audit | gap open | The e2e viewer test misses component bugs; write a focused `tools/component-test.ts` for the `components/component.ts` base (build/patch/super-ordering traps). Other components already have focused tests. |

## Revisit-before-start decisions

- 11c format: work-notes export as extra column vs. extra sheet — decide when starting 11c.
- 12a/12b need the built extension and live credentials; they are user runs, not `npm test`.
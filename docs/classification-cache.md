# Classification cache — progress log

This file tracks the implementation of the durable per-note classification-result
cache (branch `feature/classification-cache`), per the agreed plan. Update it as
each milestone lands.

## Plan summary

Two complementary layers:

1. **Full cache** — IndexedDB `snAnalyzerClassCache` keyed by
   `hash(notes + rootCauseLabels + resolutionLabels + modelId)`, so an unchanged
   note is never re-inferred (deterministic or ML) — even across datasets and
   page loads. Bounded (~2000, LRU-ish). Opt-in default = ON.
2. **Per-row cache** — rows persist a `notesHash` in `lastData`; a row already
   carrying both fields with an unchanged `notesHash` is skipped entirely.

Decisions locked: cache ON by default (`ml.cacheEnabled` default `true`) with a
Settings toggle; ML path caches in the worker via IndexedDB; Settings exposes a
"Clear classification cache" button; include the minimal per-row cache.

## Why the key includes the label lists (and model id)

The root-cause candidate list depends on the ticket type (INC / PTASK / …), so
the SAME note text can legitimately map to different labels under different
lists. Caching on `notes` alone would leak an incident result onto a PTASK row.
Including `rootCauseLabels`, `resolutionLabels` and `modelId` in the hash means
a cached result is only reused for a genuinely identical input.

## Milestones

- [x] **M1 — cache repository + tests**
  `data/classification-cache-repository.ts` (own IDB DB; `get/put/noteHit/stats/clear`;
  FNV-1a `hashKey`; bounded eviction) + `tools/classification-cache-test.js`.
  Committed.
- [x] **M2 — deterministic cache wiring**
  `services/classifier-service.ts` wraps the compute in `classifyCached` (cache hit
  → reuse + `noteHit`; miss → compute + `put`), gated by `cacheEnabled` (default true)
  and `modelId` ("deterministic"). The store degrades to a no-op when IndexedDB is
  unavailable so it stays safe in plain node. Tests: cached reuse (compute runs once),
  disabled path. Committed.
- [x] **M3 — ML cache wiring**
  `worker/classifier-worker.ts` builds a `ClassificationCacheStore` per run and
  `classifyCached` checks it per input (miss → infer + put; hit → reuse + noteHit).
  `modelId`/`cacheEnabled` travel through the `classify` request. `surfaces/viewer/classify.ts`
  `mlPass` now sends them. Committed.
- [x] **M4 — per-row notesHash skip**
  `surfaces/viewer/classify.ts` adds `hashNotes`/`alreadyClassified`. A row already
  carrying both fields AND with an unchanged note hash is skipped in the
  deterministic pass and excluded from ML targets; `row.notesHash` is written on
  classify and persists via `lastData`. Tests: `tools/per-row-cache-test.js`. Committed.
- [x] **M5 — Settings toggle + clear button**
  `ml.cacheEnabled` (default true) added to the settings shape, `normaliseSettings`,
  `PluginMl`, `collect()`/`fill()`. Settings ML card gains a "Cache classification
  results" checkbox + "Clear classification cache" button (wired via
  `surfaces/settings/index.ts` → `page.mlCache`). Tests: `settings-service-test.js`.
  Committed.
- [x] **M6 — full gate + docs**
  Final release gate green: typecheck, lint, 284 tests, build. Docs updated;
  all milestones committed on `feature/classification-cache`.

## Result: how the cache works end-to-end

- **Full cache** (`snAnalyzerClassCache`): deterministic results cached in
  `ClassifierService.classifyCached`; ML results cached in the worker's
  `classifyCached`. Key = `hash(notes + rootCauseLabels + resolutionLabels +
  modelId)`, so an unchanged note is never re-inferred — across datasets and
  page loads — while a changed note, a different ticket-type label list, or a
  different model each get their own entry.
- **Per-row cache**: `row.notesHash` (persisted in `lastData`) lets a row already
  carrying both fields with unchanged notes be skipped in both passes.
- **Opt-in**: `ml.cacheEnabled` (default true) toggle + "Clear classification
  cache" button in Settings → ML classification card.

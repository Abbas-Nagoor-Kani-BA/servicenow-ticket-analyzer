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
- [ ] M3 — ML cache wiring in `worker/classifier-worker.ts` + `ml-classify.ts`.
- [ ] M4 — per-row `notesHash` skip in `surfaces/viewer/classify.ts` + `grid.ts`.
- [ ] M5 — Settings toggle `ml.cacheEnabled` + "Clear classification cache" button.
- [ ] M6 — full gate + docs update.

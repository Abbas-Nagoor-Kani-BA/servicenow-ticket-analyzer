# Invariants — Do Not Change Without Understanding

This is the ADR-style record of the non-obvious rules that the whole plugin depends
on. Each has a hard "why it breaks" consequence. If you ever feel the urge to
"clean up" one of these, read the corresponding rule first — a seemingly-correct
tidy can silently change behavior or leak data.

Cross-reference: `AGENTS.md`, `docs/filtering.md`, `docs/timeline.md`,
`docs/architecture.md`.

---

## Invariant 1 — ServiceNow evaluates encoded queries strictly left-to-right

**Where:** `lib/querybuilder.js` (`buildEncodedQuery`, `encodeConditions`) +
`background.js` scope injection.

**Rule:** The conditions fragment (which may contain `^OR`) MUST be the first
token in the encoded query. Everything scoping (queue `assignment_group.nameIN…`,
date range, state/priority `IN`s, raw query) is ANDed *after* it.

**Why it breaks:** SN parses encoded queries sequentially. A `^OR` placed after
other ANDed scopes does NOT OR with just the preceding condition — it ORs over
the **entire preceding expression**. If queue scope were ANDed first and then a
`^OR` came after, the OR arm would match essentially the whole table, leaking
tickets outside the user's configured queues.

**Enforcement:**
- `encodeConditions` is called only to produce the leading fragment
  (`buildEncodedQuery` pushes it first, `querybuilder.js:64-67`).
- `buildEncodedQuery` **hard-rejects** any raw query containing a top-level
  `^OR` (`/(^|\^)OR/`, `querybuilder.js:101-105`) with a specific error message.
- Queue scope is emitted **unconditionally** whenever `groupNames` are present
  (no `onlyMyQueue` gate — that flag was removed after it silently dropped
  queue scoping and pulls returned 0 rows).

**Do not:** move the conditions fragment later in the join, reorder parts, or
"relax" the `^OR` rejection.

---

## Invariant 2 — The four timeline rules (business requirements)

**Where:** `analysis/phase2.js` (`extractTimelines`, `analyzeAll`).

These are business requirements; their semantics must not change without
explicit sign-off. Replayed chronologically across activity events:

1. **assignTime** — LAST time `assignment_group` changed **to** the target queue.
   - Born-in-queue fallback: if there are no group-change events but the ticket's
     CURRENT group equals the queue, `assignTime = opened_at`.
   - Clamped to never precede `opened_at` (cosmetic, for backdated demo audits).
     The clamp does NOT affect ackn eligibility, which stays event-based.
2. **acknTime** — LAST time `assigned_to` became a member of the queue's team,
   counted **only** if at/after the latest queue-entry event. Earlier assignments
   are ignored by design.
3. **suspendTime** — FIRST transition INTO "On Hold" **while current group ==
   queue**. On Hold while assigned elsewhere does NOT count.
4. **resumeTime** — FIRST post-suspend transition to "In Progress"; if none, fall
   back to first post-suspend "Resolved". Null if never resumed.

**Asymmetry that trips people up:** LAST-wins for `assignTime`, but FIRST-wins
for `acknTime`/`suspend`/`resume`. Group changes reset "in queue" context.

**Name-space matching:** queue name, snapshot group name, and team-member names
are compared case-insensitively/trimmed (`nameKey`). `memberNames` = the flat
configured team-member list applied to EVERY selected queue.

**State labels:** Off-Hold/resume detection uses the OOB maps in
`lib/statechoices.js` (value→label). Feed events carry display labels ("On Hold");
legacy sys_audit rows carried raw values ("3"). Both are resolved via the stateMap
key lookup first, falling back to treating the value as the label itself.

**Regression coverage:** `tools/phase2-unit-test.js` pins the cases — pre-queue
ackn ignored, first-On-Hold wins, direct-resolve fallback, suspend only while in
queue, group re-entry takes latest, excludeClosed suppressed when states picked.

---

## Invariant 3 — The Excel template surgery (OpenXML byte transparency)

**Where:** `lib/templatexml.js` (`fillTemplateBuffer`, `patchSummarySlaSheet`).

The user brings their **own formatted `.xlsx` template**. The plugin patches it
at the zip/XML level and never re-serializes with a spreadsheet library
(ExcelJS/SheetJS re-serialization corrupts formatted templates → Excel "repair"
prompt).

**Rules that must hold:**

1. **Never fall back to another sheet.** `findTargetSheetPath` matches the wanted
   sheet by normalized name (case-insensitive, `_`/space interchangeable) via
   `xl/workbook.xml` + its rels, "exact" then "loose". It returns `null` rather
   than silently patching a wrong sheet — a wrong-sheet fill once emptied the
   user's report.
2. **Byte-transparency.** Every zip entry other than the target sheet is
   re-emitted byte-identical (fflate `unzipSync`/`zipSync` round-trip).
3. **Rows before the header are kept verbatim.** The header row is auto-detected
   by finding "reference" in column E (resolving `t="s"` sharedStrings). Rows ≥
   header+1 are dropped and replaced with `t="inlineStr"` cells built from the
   fixed column map, **inheriting the template's per-column `s=` style**
   harvested from its first data rows (so borders/number formats survive).
4. **The `<dimension>` is updated** to the new row count.
5. **Stale-formula protection.** If formula rows get deleted, the plugin strips
   `xl/calcChain.xml` (+ its Content_Types override + workbook rel) and sets
   `fullCalcOnLoad="1"` on `<calcPr>` — otherwise Excel shows its repair dialog
   on stale chain references.
6. **Summary SLA sheet** (`patchSummarySlaSheet`): keyed on normalized
   `metric|category|sla`, carries metric/category forward across merged-style
   rows, writes Count/Total (columns I/J) numerically, and overwrites H (actual)
   and K (status) **only where the cell has no formula**. Inserts absent I/J cells
   inheriting the row's G-column style. Silent no-op when the sheet is absent.

**Do not:** rewrite this with a spreadsheet library, relax sheet-name fallback,
skip the calcChain stripping, or write formulas to H/K.

---

## Cross-cutting: timezone contract

Displayed times must match the **instance clock**, never the browser. The only
reliable source is SN's display/raw pair per record. Keep fetching residential
companion fields via `sysparm_display_value:"all"`, and keep using
`lib/sntime.js` (`parseSnDisplayMs`, `rowOffsetMs`, `detectSnOffsetMs`) — don't
re-introduce a second date parser (was deduped out of `analysis/phase2.js`; the
canonical `parseSnDisplayMs` returns `null` on failure, not `NaN`).

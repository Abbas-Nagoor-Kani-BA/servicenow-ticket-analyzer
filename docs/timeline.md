# Timeline and SLA computation

Business requirements — never change semantics without asking.

## The four timeline rules

Computed in `core/phase2.ts` from timeline events (`assignment_group`,
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
3. **suspendTime** — FIRST transition INTO "On Hold" while current group ==
   queue. State labels come from `core/statechoices.ts`. Feed events carry
   DISPLAY LABELS ("On Hold"); legacy sys_audit rows carried raw values ("3") —
   both are accepted.
4. **resumeTime** — FIRST post-suspend transition to "In Progress"; if none,
   fall back to first post-suspend "Resolved". Null if never resumed.

On Hold transitions while assigned elsewhere do NOT count. Group changes reset
queue context.

Derived durations (assign→ackn, assign→resolve, suspend total) are computed in
`core/durations.ts` from these four UTC timestamps.

## Timezone contract

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

## Export sheet lookup

Sheet lookup normalizes names (`_`/space/case-insensitive, exact then loose) and
NEVER silently falls back to another sheet — a wrong-sheet fill once emptied a
user's report. If formula rows get deleted, strip `xl/calcChain.xml` and set
`fullCalcOnLoad="1"` on `<calcPr>`, or Excel raises its repair dialog.

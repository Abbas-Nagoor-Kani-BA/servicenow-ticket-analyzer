# Timeline & SLA Calculation — How It Works

This document explains how the ServiceNow Ticket Analyzer computes per-ticket
timeline milestones and derives SLA metrics from them, from raw activity-feed
events to the final Excel export.

Timeline calculation happens in **two stages**:

```
analysis/phase2.js  →  extracts four timeline milestones from activity events
analysis/report.js  →  uses those milestones + ticket fields to compute SLA numbers
```

---

## 1. Data Source

For every ticket pulled in Phase 1, the plugin fetches the ticket's own activity
feed via the `list_history.do` endpoint (one request per ticket). This endpoint
returns a complete dump of all field-change entries, newest-first, with no
pagination.

Three fields are tracked for timeline analysis:

| Field | What it represents | Events used for |
|---|---|---|
| `assignment_group` | Which queue the ticket is assigned to | Queue entry / exit |
| `assigned_to` | Which individual the ticket is assigned to | Acknowledgement detection |
| `state` | Current lifecycle state of the ticket | Suspension and resume detection |

The `incident_state` field (incident-specific) is automatically renamed to
`state` during feed parsing so the timeline engine works uniformly across all
ticket tables.

Each event carries a raw UTC timestamp (`sys_created_on`) and display-label
old/new values. The engine resolves raw numeric values (e.g. `"3"`) and display
labels (e.g. `"On Hold"`) interchangeably via the out-of-box state maps in
`lib/statechoices.js`.

---

## 2. Timeline Extraction

The `extractTimelines()` function in `analysis/phase2.js` receives a ticket's
activity events and a context object, then replays events in chronological order
to produce four milestone timestamps.

### 2.1 assignTime — Queue Entry

The clock for "time in queue" starts when the ticket enters the target queue.
This is determined by watching `assignment_group` change events.

The rule is straightforward: **assignTime is the LAST time
`assignment_group` changed TO the target queue.** If a ticket bounces in and
out of the queue multiple times, only the latest re-entry counts — this
represents when the ticket most recently became the queue's responsibility.

If no group-change events exist at all (the ticket was auto-routed at creation
and never moved), a born-in-queue fallback fires: the ticket's current snapshot
group is compared to the target queue, and if they match, `assignTime` is set to
`opened_at`. This covers tickets whose group was set at creation without
producing an audit row.

AssignTime is always clamped to never precede `opened_at`. This handles
backdated audit entries that might appear before the ticket was actually created.
The clamp is cosmetic only — it does not affect acknowledgement eligibility,
which remains event-based.

| Scenario | assignTime result |
|---|---|
| Group changed to target queue at 10:00, then out, then back at 14:00 | 14:00 (latest entry) |
| No group events, current group matches queue, opened_at = 08:00 | 08:00 (born-in-queue fallback) |
| No group events, current group does NOT match queue | null (ticket never entered queue) |
| Group changed to queue at 06:00, but opened_at = 08:00 | 08:00 (clamped to birth) |
| Group changed to queue at 10:00, opened_at missing | 10:00 (no clamp applied) |

### 2.2 acknTime — Team Acknowledgement

Acknowledgement measures how quickly a team member picks up the ticket after it
enters the queue. The rule: **acknTime is the FIRST time `assigned_to` changed
to a team member at or after the latest queue-entry event.**

Assignments are collected across the entire event timeline, then filtered
post-loop against the queue-entry timestamp. This design handles same-second
"group changed + assigned to member" pairs correctly — a same-second assignment
counts as acknowledgement.

Only assignments TO team members (names matching the configured team list,
case-insensitive) are considered. Assignments to non-team members, or
unassignment (empty value), are ignored for acknowledgement purposes.

| Scenario | acknTime result |
|---|---|
| Queue entry at 10:00, assigned to team member at 10:05 | 10:05 |
| Assigned to team member at 09:00, queue entry at 10:00 | null (pre-queue assignment ignored) |
| Assigned to non-team member at 10:05, team member at 10:10 | 10:10 (non-team assignments skipped) |
| Queue entry at 10:00, no team member assignment ever | null |
| Queue entry at 10:00, assigned to team member at 10:00 (same second) | 10:00 (same-timestamp qualifies) |

### 2.3 suspendTime — On Hold

Suspension tracks when the ticket enters an "On Hold" state while it is the
target queue's responsibility. The rule: **suspendTime is the FIRST transition
INTO "On Hold" while the ticket's current group matches the target queue.**

State transitions are only evaluated when the ticket is currently in the target
queue. If the ticket goes On Hold while assigned to a different queue, that
suspension is not counted — it belongs to the other queue's timeline.

The engine resolves state values through the out-of-box state map first (raw
numeric `"3"` maps to label `"On Hold"`), then falls back to treating the raw
value as the label itself. This handles both legacy `sys_audit` rows (which
carry raw values) and the activity feed (which carries display labels).

Only the first On Hold transition sets `suspendTime`. Subsequent hold events
increment `onHoldCount` but do not overwrite the original timestamp.

| Scenario | suspendTime result |
|---|---|
| State: In Progress → On Hold at 12:00 (while in queue) | 12:00 |
| State: In Progress → On Hold at 12:00 (while in OTHER queue) | null (hold while elsewhere ignored) |
| Hold at 12:00, resume, hold again at 14:00 | 12:00 (first hold wins) |
| State: In Progress → "3" at 12:00 (raw value, maps to On Hold) | 12:00 (stateMap resolves) |
| Never enters On Hold state | null |

### 2.4 resumeTime — Resume from Hold

Resume tracks when the ticket returns to active work after being On Hold. The
rule: **resumeTime is the FIRST post-suspend transition to "In Progress".** If
no "In Progress" transition occurs after the suspend, the engine falls back to
the first post-suspend transition to "Resolved".

Resume is only detected if a valid suspend exists in the queue. The engine
enforces temporal ordering — the resume event must occur at or after the suspend
timestamp — to prevent out-of-order events from producing spurious resumes.

| Scenario | resumeTime result | resumeSource |
|---|---|---|
| On Hold → In Progress at 13:00 | 13:00 | "In Progress" |
| On Hold → Resolved at 13:00 (no In Progress step) | 13:00 | "Resolved" |
| On Hold → In Progress → On Hold → In Progress | first resume time | "In Progress" (second resume ignored) |
| On Hold → Closed (no In Progress, no Resolved) | null | null |
| Never On Hold | null | null |

---

## 3. SLA Calculation

The `buildReport()` function in `analysis/report.js` takes a ticket row and the
formatted timeline milestones, then derives every SLA-related column in the
report. The three primary duration metrics are explained below.

### 3.1 incidentHours — Total Ticket Age

This measures the total time from ticket creation to resolution.

For P1 and P2 tickets, this is simple elapsed time: the difference between
`resolvedAt` and `createdOn` in hours, with no business-hours filtering. A P2
ticket resolved at 2:00 AM on a Sunday still counts every hour.

For P3 and P4 tickets, only business hours count: 08:00 to 17:00, Monday
through Friday. Nights, weekends, and holidays are excluded. If the ticket was
put On Hold and later resumed, the business hours during that hold period are
subtracted from the total.

If the ticket is not yet resolved, the clock runs to the current moment.

| Formula | P1/P2 | P3/P4 |
|---|---|---|
| Clock starts | createdOn | createdOn |
| Clock ends | resolvedAt (or now) | resolvedAt (or now) |
| Duration type | Elapsed (24/7) | Business hours only |
| Hold deduction | None | Business hours between suspend and resume |

### 3.2 incCurrentHours — Time in Queue

This measures the time the ticket spent in the team's queue, from assignment to
resolution. It answers "how long was this our responsibility?"

The clock starts at `assignTime` (queue entry) rather than `createdOn` (ticket
creation), so time spent in other queues before arrival is excluded. The same
P1/P2 vs P3/P4 business-hours distinction applies.

A special case exists for unresolved tickets that are On Hold but never resumed:
the clock stops at `suspendTime` rather than continuing to the current moment.
This prevents an unresolved, indefinitely-held ticket from accumulating
infinite hours.

| Scenario | incCurrentHours behavior |
|---|---|
| Resolved P3 ticket, 3 business days from assignment | Counts 3 business days |
| Open P3 ticket, assigned yesterday, never held | Counts from assignment to now (business hours) |
| Open P3 ticket, On Hold since Tuesday, never resumed | Clock stops at Tuesday (holds the frozen duration) |
| Resolved P2 ticket, assigned Friday, resolved Monday | Elapsed hours across the weekend |

### 3.3 responseSLA — Acknowledgement Speed

This measures how quickly the team acknowledged the ticket after it entered the
queue. The clock runs from `assignTime` to `acknTime`.

If the ticket has not been acknowledged yet, the clock runs to the current
moment. For P3 and P4 tickets, the hold deduction is capped at the
acknowledgement time — this prevents subtracting suspension time that occurred
after the ticket was already acknowledged.

| Formula | P1/P2 | P3/P4 |
|---|---|---|
| Clock starts | assignTime | assignTime |
| Clock ends | acknTime (or now) | acknTime (or now) |
| Duration type | Elapsed (24/7) | Business hours only |
| Hold deduction | None | Business hours between suspend and resume, capped at acknTime |

### 3.4 Priority Thresholds

SLA thresholds determine whether a ticket met its target. The thresholds differ
by priority:

| Priority | Min (hours) | Max (hours) | Duration type |
|---|---|---|---|
| P1 — Critical | 2 | 4 | Elapsed (24/7) |
| P2 — High | 4 | 8 | Elapsed (24/7) |
| P3 — Moderate | 1 | 5 | Business hours |
| P4 — Low | 10 | 15 | Business hours |
| P5 — Planning | 10 | 15 | Business hours (clamped to P4) |

The three SLA pass/fail flags are evaluated as follows:

| Flag | Condition |
|---|---|
| metResponseSLA | responseSLA ≤ priority max threshold |
| metMinResolutionSLA | incidentHours ≤ priority min threshold |
| metMaxResolutionSLA | incidentHours ≤ priority max threshold |

A ticket exactly at the threshold counts as "YES" (met). Unknown priorities
(P0 or unparseable) produce empty SLA flags.

---

## 4. Column Mapping

The timeline milestones flow into both the viewer grid and the Excel export.
Each timeline field maps to a report key and then to a specific Excel column.

| Timeline field | Report key | Excel column | Description |
|---|---|---|---|
| assignTime | assigned | L | Queue entry timestamp |
| acknTime | ackn | M | Acknowledgement timestamp |
| suspendTime | susp | O | First On Hold timestamp |
| resumeTime | resumed | P | Resume from hold timestamp |
| resolvedAt | resolved | N | Resolution timestamp |
| createdOn | created | K | Ticket creation timestamp |

The SLA-derived columns in the Excel export:

| Report key | Excel column | Description |
|---|---|---|
| incidentHours | Z | Total age in HH:MM:SS |
| incidentTotalAge | AA | Total age in days (hours / 9) |
| incCurrentHours | AB | Time in queue in HH:MM:SS |
| incidentCurrentAge | AC | Time in queue in days (hours / 9) |
| responseSLA | AD | Acknowledgement speed in HH:MM:SS |
| metResponseSLA | AH | YES / NO / empty |
| metMinResolutionSLA | AI | YES / NO / empty |
| metMaxResolutionSLA | AJ | YES / NO / empty |

# report.js business-hours timezone bug

Status: **fixed** (commit on branch `fix/timezone-format-clarity`; verified by running
`tools/report-test.js` under multiple `TZ` values with identical results).

---

## Problem

`analysis/report.js` `parseDate` (renamed `parseDisplayWallClock` in the
format-clarity pass) builds a `Date` from a `yyyy-MM-ddTHH:mm:ss` string with no
timezone suffix:

```js
new Date(`${yyyy}-${mm}-${dd}T${timePart || "00:00:00"}`)  // NO Z → browser-local
```

A local `Date` with no suffix is interpreted in the **browser's timezone**, not
the instance's. All business-hours / SLA arithmetic that flows through it
(`businessHoursBetween`, `calcBusinessHours`, `calcIncCurrentHours`,
`calcResponseSLA`, `calcTotalAgeDays`) therefore assumes the wall-clock the strings
carry is in the browser's zone.

The strings are instance-display wall-clock (e.g. `06-06-2026 23:39:14` for a
UTC+5:30 instance). If the browser is in, say, US/Eastern (−4h/−5h), the integer
hours-of-day map onto the wrong timezone and the work-day boundaries (08:00–17:00
Monday–Friday) are evaluated against the wrong zone.

This is independent of the display/UTC choice — it exists whether timestamps are
rendered as display strings or kept as UTC ISO.

---

## Impact

- `incidentHours` / `incidentTotalAge` / `incidentCurrentAge` and the P3/P4
  business-hours paths can be off when browser TZ ≠ instance TZ.
- P1/P2 use plain elapsed-time (`(end - start) / 3600000`) over the same parsed
  (wrong-zone) `Date`s — those differences are TZ-agnostic (both endpoints share
  the zone), so P1/P2 fractional results are unaffected; only the wall-clock
  labels and day-of-week boundary logic are wrong.

---

## Fix implemented

`parseDisplayWallClock` now builds the `Date` via a zone-independent `Date.UTC`
projection (`new Date(Date.UTC(+yyyy, +mm-1, +dd, h, mi, s))`) and all
business-hours math (`businessHoursBetween`, `calcBusinessHours`,
`calcIncCurrentHours`, `calcResponseSLA`) reads those fields with `getUTC*` /
`Date.UTC` day boundaries — so the work-day (08:00–17:00 Mon–Fri) boundaries are
evaluated against the **instance display wall-clock**, independent of the
browser's timezone.

The three calc functions now accept `offsetMs = 0` and use
`new Date(Date.now() + offsetMs)` for their open-ticket "now" fallbacks, so an
open ticket's elapsed/current business hours are also computed in instance
wall-clock space. `buildReport` derives `instanceOffsetMs` per row via
`pairOffsetMs(row.openedAt, row.openedAtRaw)`.

Verified by running `node tools/report-test.js` under
`UTC / America/New_York / America/Los_Angeles / Asia/Kolkata / Pacific/Kiritimati`
— identical results in every zone. Related: during the earlier format-clarity
rename, `extractEventsFromActivity` had also renamed the emitted event field
from `at` to `atIso`, which silently broke the stream→`analyzeAll` contract
(`normalizeEvents`/`analyzeAll` read `r.at`); the field was restored to `at`
(the local parse variable stays `atIso` for readability).

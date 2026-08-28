# report.js business-hours timezone bug

Status: **open (unfixed)** — documented so it does not get lost.

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

## Suggested fix (not yet implemented)

Options:

1. **Parse as instance-local with the row offset** — convert the display string
   using the instance offset rather than the browser zone:
   ```js
   function displayToEpoch(displayStr, offsetMs) {
     const epoch = parseSnDisplayMs(displayStr);   // display parsed as-if UTC
     return epoch - offsetMs;                       // subtract offset → real UTC epoch
   }
   ```
   Then do business-hours math in epoch space with the instance offset applied,
   matching how `fmtInstant` renders.

2. **Operate on UTC-ISO milestones directly** (bypass `parseDate` entirely) so
   there is no wall-clock parsing at all.

The fix should be verified against an instance/browser with differing zones.

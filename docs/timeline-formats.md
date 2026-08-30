# Timeline Times: Extract → Transform → Display (and the format convention)

This is the canonical reference for how the four timeline timestamps
(`assignTime`, `acknTime`, `suspendTime`, `resumeTime`) flow out of the
ServiceNow history API, and why the code uses so many datetime formats.

Status: **convention applied** — every date variable now carries a `*UtcIso`,
`*Epoch`, `*Display` (or similar) suffix that names its format, so a reader can
tell from the identifier alone which stage of the pipeline they are looking at.

---

## 0. The format reference table (read this first)

This table is the single source of truth for "what format is a value, and which
converter changes it". If you are reading code that deals with a date, locate the
variable here by its suffix.

| # | Stage | Format (suffix) | Example | Code / holder | Converter |
|---|---|---|---|---|---|
| 1 | `list_history.do` `sys_created_on` | raw UTC string (`UTC_RAW`) | `2026-08-14 08:14:43` | `extractEventsFromListHistory` output | — |
| 2 | activity-stream text anchor | display string (`Display`) | `14-08-2026 13:44:43` | `extractEventsFromActivity` | `scanSnDateTime` ⇒ ISO UTC |
| 3 | sort + timeline rules | epoch ms (`Epoch`) | `1786695283000` | `normalizeEvents` → rules | `utcRawToEpochMs` |
| 4 | stored milestones | UTC ISO (`UtcIso`) | `2026-08-14T08:14:43.000Z` | row fields `assignTimeUtcIso`… | `epochMsToUtcIso` |
| 5 | viewer display | instance-local wall clock (`Display`) | `14-08-2026 13:44:43` | `fmtInstant` / `panelFmt` output | `rowOffsetMs` + `getUTC*` |

**Naming convention:** whenever you write a date, append its format suffix to
the identifier. Do not leave a date variable "formatless" — the whole point is
that reading the name shows the format. The converters are tiny names for the
primitive helpers, so every boundary reads as an explicit stated conversion.

---

## 1. What the raw `list_history.do` response gives per entry

Each entry describes one moment; `changes[]` holds the field transitions at that
moment. There are THREE timestamp fields, all the same instant, three encodings:

```json
{
  "document_id": "a86933ea...",
  "entries": { "changes": [
    { "field_name": "state", "old_value": "Resolved", "new_value": "Closed" }
  ]},
  "sys_created_on":          "2026-08-14 08:14:43",  // RAW UTC (no Z)
  "sys_created_on_adjusted": "14-08-2026 13:44:43",  // INSTANCE display (UTC+5:30)
  "sys_timestamp":           1786695283000           // epoch ms
}
```

| Field | Zone / format | Used today? |
|---|---|---|
| `sys_created_on` | Raw UTC, `yyyy-MM-dd HH:mm:ss` | YES — event `at` (UTC_RAW) |
| `sys_created_on_adjusted` | Instance display, profile-dependent format | NO — discarded |
| `sys_timestamp` | Epoch ms | NO — discarded |

`sys_created_on_adjusted` is ALREADY the instance-local time shown in the
ServiceNow Activity UI.

---

## 2. Real-data walkthrough (from `tools/sample.json`)

Note: `tools/sample.json` is the FINAL analyzed output (215 rows), not the raw
history response — it sits one stage after the API. Real ticket INC2449017 (IST,
UTC+5:30):

| Field | Raw UTC | Instance display | fmtInstant shows |
|---|---|---|---|
| openedAt | `2026-06-06 18:09:14` | `06-06-2026 23:39:14` | `23:39:14` |
| assignTime | `2026-06-06T18:09:15.000Z` | — | `23:39:15` |
| acknTime | `2026-06-07T09:08:18.000Z` | — | `14:38:18` |
| suspendTime | `2026-06-09T04:33:04.000Z` | — | `10:03:04` |
| resumeTime | `2026-08-18T06:00:28.000Z` | — | `11:30:28` |
| resolvedAt | `2026-08-18 06:00:24` | `18-08-2026 11:30:24` | `11:30:24` |

Offset oracle: `23:39:14` display − `18:09:14` raw = **+5.5h**. The `assignTime`
display (`23:39:15`) is RECONSTRUCTED by adding that offset onto raw UTC — the
code never uses `sys_created_on_adjusted`.

---

## 3. The offset-detection chain (`lib/sntime.js`)

SN has NO reliable API-visible timezone source (`sys_user.time_zone`,
`sys_user_preference`, `glide.sys.default.tz` can all be empty). So the offset is
reverse-engineered from the display/raw pairs we already have:

```js
pairOffsetMs(disp, raw) = parseSnDisplayMs(disp)  // display parsed AS-IF UTC
                       - Date.parse(raw + "Z")    // raw UTC
```

- `detectSnOffsetMs(rows)`: median across up to 200 rows (sanity-cut ±15h).
- `rowOffsetMs(row, fallback)`: per-row pair first (DST fix), else median.
- `parseSnDisplayMs` supports `yyyy-MM-dd`, `dd-MM-yyyy`, `dd.MM.yyyy`,
  `MM/dd/yyyy` + AM/PM — but by design treats input as UTC; valid only as a
  difference term, never a real instant.

---

## 4. The `/api/now/v1/activity/stream` fallback

Degraded path used when `list_history.do` is blocked. Timestamps only exist as
text substrings; `scanSnDateTime`/`parseSnDisplayMs` parse them AS-IF UTC with
no display/raw pair to derive an offset. The offset is baked into the instant and
later `fmtInstant` double-shifts by one instance offset. Known, accepted
approximation — the primary list_history path does not have this problem.

---

## 5. Why so many formats?

1. **Computation needs epoch ms** for correct chronological ordering of the four
   rules (born-in-queue fallback, clamp, pre-queue ackn ignored).
2. **Display needs instance-local wall-clock** matching the Activity UI.
3. **Business hours need wall-clock arithmetic.**
4. **The instance offset has no API source**, so it must be reverse-engineered
   from display/raw pairs → the parse/offset apparatus.

---

## 6. Problems with using display time (`sys_created_on_adjusted`) directly

### 6.1 Double-shift in `fmtInstant` (show-stopper)
`fmtInstant` adds the row offset to EVERY `inst` column. If a value were already
instance-local, adding the offset again shifts it by one instance offset. Raw UTC
is needed precisely so the single add renders correctly.

### 6.2 Offset detection breaks
The offset is derived from a display/raw PAIR. If timeline events carried display
time, there is no raw companion; `pairOffsetMs`/`rowOffsetMs`/DST fix all break.

### 6.3 `parseSnDisplayMs` treats display as UTC (by design)
Its output is only a difference term. Feeding real display times and using the
result as a genuine instant yields a shifted timestamp.

### 6.4 Profile-dependent format ambiguity
`sys_created_on_adjusted` format changes with the SN profile
(`dd-MM-yyyy` / `yyyy-MM-dd` / `MM/dd/yyyy`). Using display time does NOT remove
the multi-format regexes — it relocates them.

### 6.5 String sorting breaks
Timeline columns sort numerically by UTC epoch ms; `14-08-2026` display strings
do not sort numerically across date boundaries.

### 6.6 Separate `report.js` bug (independent)
`report.js` `parseDisplayWallClock` does `new Date("yyyy-MM-ddTHH:mm:ss")` — no
`Z`, so it parses as BROWSER-local, not instance-local. If browser and instance
differ, SLA business-hours math runs in the wrong zone. Tracked separately in
`issues/003-report-tz-bug.md`.

---

## 7. Status / decisions

- [x] Format-convention applied (suffix naming + named converters).
- [ ] `report.js` browser-local timezone bug — see `issues/003-report-tz-bug.md`.
- [ ] (deferred) "Option A" display passthrough via `sys_created_on_adjusted` —
      NOT adopted; keep raw UTC as canonical compute/store format.

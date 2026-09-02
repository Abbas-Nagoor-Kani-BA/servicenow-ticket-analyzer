# Known Limits / Roadmap

## Known limits

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

## Roadmap

- Possible future work: resume-from-checkpoint for huge pulls (Phase 11a),
  work-notes text export (Phase 11c), additional tables (RITM, change)
  (Phase 11d).
- Shipped: derived duration columns (Phase 11b, `core/durations.ts`); Calclens
  "needs attention" row flags (Phase 11e, `core/attention.ts`).

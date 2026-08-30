import * as Journal from "../../core/journal.js";
import { el } from "./core.js";
import { fmtInstant } from "./grid.js";
import { setTip } from "../../lib/tooltip.js";


const FIELD_LABELS = {
  assignment_group: "Assignment group",
  assigned_to: "Assigned to",
  state: "State",
  incident_state: "State",
  priority: "Priority",
  impact: "Impact",
  urgency: "Urgency",
  severity: "Severity",
  close_code: "Close code",
  contact_type: "Contact type",
  category: "Category",
  subcategory: "Subcategory",
  cmdb_ci: "Configuration item",
  escalation: "Escalation",
  resolved_by: "Resolved by",
  email: "Email"
};
function fieldLabel(f) {
  const k = String(f || "").toLowerCase();
  return FIELD_LABELS[k] ||
    String(f || "").replace(/u002e/g, ".").split(/[._]/).filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Change";
}
function fieldChangeEntries(row) {
  return (row.activity || []).map(ev => {
    const iso = Number.isFinite(ev.atEpoch) && ev.atEpoch !== null
      ? new Date(ev.atEpoch).toISOString() : "";
    return {
      label: "Field change",
      cls: "fc",
      author: "",
      time: iso ? fmtInstant(iso, row) : "",
      sort: Number.isFinite(ev.atEpoch) ? new Date(ev.atEpoch).toISOString().replace("T", " ").slice(0, 19) : "",
      text: `${fieldLabel(ev.f)}: ${ev.o || "(empty)"} → ${ev.n || "(empty)"}`
    };
  });
}
function activityPaneEl(row) {
  const wrap = el("div", "msrPickNotes");
  const head = el("div", "msrPickNotesHead");
  const body = el("div", "msrPickNotesBody");
  const journal = Journal.build(row);
  const pinned = [];
  const summary = String(row.shortDescription || "").trim();
  if (summary) pinned.push({ label: "Summary", cls: "sum", time: "", author: "", text: summary });
  const stream = [
    ...journal,
    ...fieldChangeEntries(row)
  ].sort((a, b) => Journal.sortKey(b).localeCompare(Journal.sortKey(a)));
  head.textContent = `${row.number || ""} · Activity · ${pinned.length + stream.length} ${pinned.length + stream.length === 1 ? "entry" : "entries"}`;
  if (!stream.length && !pinned.length) {
    const d = el("div", "noteEmpty");
    d.textContent = "No work notes, customer comments or field changes on this ticket.";
    body.appendChild(d);
  }
  const renderPinnedCard = n => {
    const item = el("div", `noteItem ${n.cls}`);
    const meta = el("div", "noteMeta");
    const lab = el("span", "noteLabel");
    lab.textContent = n.label;
    meta.append(lab);
    const bd = el("div", "noteBody");
    bd.textContent = n.text;
    item.append(meta, bd);
    body.appendChild(item);
  };
  const renderEntryBlock = n => {
    const wrapE = el("div", `noteEntry ${n.cls}`);
    const sub = el("div", "noteSub");
    const lab = el("span", "noteLabel");
    lab.textContent = n.label;
    sub.append(lab);
    if (n.time) {
      const dot = el("span", "noteDot");
      dot.textContent = "•";
      const tm = el("span", "noteTime");
      tm.textContent = n.time;
      sub.append(dot, tm);
    }
    const bd = el("div", "noteBody");
    bd.textContent = n.text;
    wrapE.append(sub, bd);
    return wrapE;
  };
  for (const p of pinned) renderPinnedCard(p);
  for (const g of Journal.group(stream)) {
    const card = el("div", "noteGroup");
    const author = Journal.cleanAuthor(g.author);
    if (author) {
      const meta = el("div", "noteMeta");
      const av = el("span", "noteAvatar");
      av.textContent = Journal.authorInitials(author);
      setTip(av, author);
      const an = el("span", "noteAuthor");
      an.textContent = author;
      meta.append(av, an);
      card.appendChild(meta);
    }
    for (const n of g.items) card.appendChild(renderEntryBlock(n));
    body.appendChild(card);
  }
  wrap.append(head, body);
  return wrap;
}

export {
  fieldLabel,
  fieldChangeEntries,
  activityPaneEl,
  FIELD_LABELS
};

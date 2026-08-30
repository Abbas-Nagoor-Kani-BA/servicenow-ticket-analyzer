import * as Journal from "../../core/journal.ts";
import { el } from "./core.ts";
import type { ViewerRow } from "./core.ts";
import { fmtInstant } from "./grid.ts";
import { setTip } from "../../lib/tooltip.ts";

type FieldEntry = { label: string; cls: string; author: string; time: string; sort?: string; text: string };
type FieldChangeEv = { atEpoch?: unknown; f?: unknown; o?: unknown; n?: unknown };

const FIELD_LABELS: Record<string, string> = {
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

function fieldLabel(f: unknown): string {
  const k = String(f || "").toLowerCase();
  return FIELD_LABELS[k] ||
    String(f || "").replace(/u002e/g, ".").split(/[._]/).filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") || "Change";
}

function fieldChangeEntries(row: ViewerRow): FieldEntry[] {
  return (row.activity || []).map((ev: FieldChangeEv) => {
    const iso = Number.isFinite(ev.atEpoch as number) && ev.atEpoch !== null
      ? new Date(ev.atEpoch as number).toISOString() : "";
    return {
      label: "Field change",
      cls: "fc",
      author: "",
      time: iso ? fmtInstant(iso, row) : "",
      sort: Number.isFinite(ev.atEpoch as number) ? new Date(ev.atEpoch as number).toISOString().replace("T", " ").slice(0, 19) : "",
      text: `${fieldLabel(ev.f)}: ${ev.o || "(empty)"} → ${ev.n || "(empty)"}`
    };
  });
}

function activityPaneEl(row: ViewerRow): HTMLElement {
  const wrap = el("div", "msrPickNotes");
  const head = el("div", "msrPickNotesHead");
  const body = el("div", "msrPickNotesBody");
  const journal = Journal.build(row);
  const pinned: FieldEntry[] = [];
  const summary = String(row.shortDescription || "").trim();
  if (summary) pinned.push({ label: "Summary", cls: "sum", time: "", author: "", text: summary });
  const stream: FieldEntry[] = [
    ...journal as FieldEntry[],
    ...fieldChangeEntries(row)
  ].sort((a, b) => Journal.sortKey(b as Journal.Entry).localeCompare(Journal.sortKey(a as Journal.Entry)));
  head.textContent = `${row.number || ""} · Activity · ${pinned.length + stream.length} ${pinned.length + stream.length === 1 ? "entry" : "entries"}`;
  if (!stream.length && !pinned.length) {
    const d = el("div", "noteEmpty");
    d.textContent = "No work notes, customer comments or field changes on this ticket.";
    body.appendChild(d);
  }
  const renderPinnedCard = (n: FieldEntry): void => {
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
  const renderEntryBlock = (n: FieldEntry): HTMLElement => {
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
  for (const g of Journal.group(stream as unknown as Journal.JournalItem[])) {
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
    for (const n of g.items) card.appendChild(renderEntryBlock(n as unknown as FieldEntry));
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
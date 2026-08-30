import { parseSnDisplayMs } from "./sntime.ts";

type Entry = { label: string; time: string; author: string; text: string };
type Row = { workNotes?: unknown; comments?: unknown; closeNotes?: unknown; resolvedAt?: unknown };

function sortKey(e: Entry): string {
  return String((e as { sort?: string }).sort || e.time || "");
}

function cleanAuthor(a: unknown): string {
  return String(a || "").replace(/\([^)]*\)/g, "").replace(/@.*$/, "")
    .replace(/[._\-]+/g, " ").replace(/\s+/g, " ").trim();
}

function authorInitials(a: unknown): string {
  const parts = cleanAuthor(a).split(" ").filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[parts.length - 1][0] || "")).toUpperCase();
}

/**
 * Parse a journal blob (work notes/comments) into entries with a heading date.
 */
function parseEntries(blob: unknown, label: string): Entry[] {
  const txt = String(blob || "").replace(/\r\n/g, "\n").trim();
  if (!txt) return [];
  const headRe = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\s+(?:-\s*)?(.*))?$/;
  const raw: Array<{ label: string; time: string; author: string; body: string[] }> = [];
  let cur: { label: string; time: string; author: string; body: string[] } | null = null;
  for (const ln of txt.split("\n")) {
    const m = ln.match(headRe);
    if (m) {
      cur = { label, time: m[1], author: (m[2] || "").trim(), body: [] };
      raw.push(cur);
    } else if (raw.length && cur) {
      cur.body.push(ln);
    } else {
      cur = { label, time: "", author: "", body: [ln] };
      raw.push(cur);
    }
  }
  return raw
    .map(e => ({ label, time: e.time, author: e.author, text: e.body.join("\n").trim() }))
    .filter(e => e.text);
}

type JournalItem = Entry & { cls: string; sort?: string };

/**
 * Build the journal joined list for a row: work notes, customer comments and a
 * resolution note (with a sortable heading moment derived from the display
 * datetime).
 */
function build(row: Row, parseDisplayMs?: (s: string) => number | null): JournalItem[] {
  const pdp = parseDisplayMs || parseSnDisplayMs;
  const items: JournalItem[] = [];
  for (const e of parseEntries(row.workNotes, "Work note")) items.push({ ...e, cls: "wn" });
  for (const e of parseEntries(row.comments, "Customer comment")) items.push({ ...e, cls: "cm" });
  const rn = String(row.closeNotes || "").trim();
  if (rn) {
    const ms = pdp ? pdp(String(row.resolvedAt || "")) : null;
    items.push({
      label: "Resolution note",
      cls: "rn",
      author: "",
      time: row.resolvedAt ? String(row.resolvedAt) : "",
      sort: ms ? new Date(ms).toISOString().replace("T", " ").slice(0, 19) : "",
      text: rn
    });
  }
  return items;
}

type JournalGroup = { key: string; author: string; items: JournalItem[] };

function group(entries: JournalItem[]): JournalGroup[] {
  const groups: JournalGroup[] = [];
  let cur: JournalGroup | null = null;
  for (const e of entries) {
    const k = `${cleanAuthor(e.author)}|${sortKey(e)}`;
    if (cur && cur.key === k) cur.items.push(e);
    else {
      cur = { key: k, author: e.author || "", items: [e] };
      groups.push(cur);
    }
  }
  return groups;
}

export {
  sortKey,
  cleanAuthor,
  authorInitials,
  parseEntries,
  build,
  group,
};
export type { Entry, JournalItem, Row };
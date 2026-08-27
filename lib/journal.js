import { parseSnDisplayMs } from "./sntime.js";


function sortKey(e) {
  return e.sort || e.time || "";
}

function cleanAuthor(a) {
  return String(a || "").replace(/\([^)]*\)/g, "").replace(/@.*$/, "")
    .replace(/[._\-]+/g, " ").replace(/\s+/g, " ").trim();
}

function authorInitials(a) {
  const parts = cleanAuthor(a).split(" ").filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[parts.length - 1][0] || "")).toUpperCase();
}

function parseEntries(blob, label) {
  const txt = String(blob || "").replace(/\r\n/g, "\n").trim();
  if (!txt) return [];
  const headRe = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\s+(?:-\s*)?(.*))?$/;
  const raw = [];
  let cur = null;
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

function build(row, parseDisplayMs) {
  const pdp = parseDisplayMs || parseSnDisplayMs;
  const items = [];
  for (const e of parseEntries(row.workNotes, "Work note")) items.push({ ...e, cls: "wn" });
  for (const e of parseEntries(row.comments, "Customer comment")) items.push({ ...e, cls: "cm" });
  const rn = String(row.closeNotes || "").trim();
  if (rn) {
    const ms = pdp ? pdp(row.resolvedAt) : null;
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

function group(entries) {
  const groups = [];
  let cur = null;
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
  group
};

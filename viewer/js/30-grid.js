import { detectSnOffsetMs, rowOffsetMs } from "../../lib/sntime.js";
import { extractHeuristic } from "../../analysis/aiextract.js";
import { buildReport } from "../../analysis/report.js";
import { SN_TABLE_LABELS } from "../../lib/statechoices.js";
import { STORAGE } from "../../lib/keys.js";
import { pad2 } from "../../lib/format.js";
import { showToast } from "../../lib/toast.js";
import { $, COLUMNS, cellShort, columnOptionList, migrateLegacyResolutions, setStatus, visibleCols } from "./00-core.js";
import { cellValue, tsvCell } from "./15-clipboard.js";
import { applySelHighlight, ensureDefaultSelection, restorePendingSel } from "./40-selection.js";
import { copyText } from "./85-shared.js";
import { dataStore, setSelfPush } from "./00-store.js";
import { attachSummaryToData, renderSummary, setRowsProvider } from "./16-summary.js";

function st() { return dataStore.getState(); }

setRowsProvider(() => currentRows());

function load(d) {
  const data = d && Array.isArray(d.rows) ? d : null;
  dataStore.setState({ data, sortKey: null, sortDir: 1, snOffsetMs: data ? detectSnOffsetMs(data.rows) : 0 });
  let migrated = 0;
  if (data) {
    autoParse();
    migrated = migrateLegacyResolutions(data.rows);
    if (migrated) persistEdits();
  }
  if (!data || !data.rows.length) {
    $("wrap").classList.add("hidden");
    document.querySelector(".toolbar").classList.add("hidden");
    $("tabs").classList.add("hidden");
    $("summaryWrap").classList.add("hidden");
    $("empty").classList.remove("hidden");
    return;
  }
  $("tabs").classList.remove("hidden");
  const missing = data.missingAudit ? ` · ${data.missingAudit} without timeline events` : "";
  const runs = data.runs || [];
  const lastRun = runs[runs.length - 1];
  let scope;
  if (runs.length) {
    const groups = [...new Set(runs.map(r => r.group))];
    scope = `${runs.length} run(s) · groups: ${groups.join(", ")}`;
  } else {
    scope = `${SN_TABLE_LABELS[data.table] || data.table} · group "${data.group}"`;
  }
  $("meta").textContent =
    `${scope} · pulled ${data.at.slice(0, 16).replace("T", " ")}${missing}`;
  if (lastRun?.cached) {
    const badge = document.createElement("span");
    const age = lastRun.cacheAt ? ` (${Math.max(1, Math.round((Date.now() - lastRun.cacheAt) / 60000))} min old)` : "";
    badge.textContent = ` · cached data${age}`;
    badge.style.cssText = "color:#fab387;font-weight:600;";
    $("meta").appendChild(badge);
  }
  if (data.debug && data.debug.ticketsWithAudit === 0) {
    const warn = document.createElement("div");
    warn.style.cssText = "padding:6px 18px;color:#fab387;font-size:12px;";
    warn.textContent =
      "No timeline events found for any pulled ticket. Common causes: (1) the activity feed returned nothing - open a ticket's form in this instance's tab and check its Activity section renders field changes; (2) tickets were never updated through the platform; (3) list_history.do is blocked on this release. Timeline columns stay empty without feed events.";
    $("meta").after(warn);
  }
  buildHead();
  render();
  restorePendingSel();
  ensureDefaultSelection();
  if (attachSummaryToData(data)) scheduleSave();
  renderSummary();
}

function buildHead() {
  const { sortKey, sortDir } = st();
  const table = $("tbl");
  let colgroup = table.querySelector("colgroup");
  if (!colgroup) {
    colgroup = document.createElement("colgroup");
    table.prepend(colgroup);
  }
  colgroup.innerHTML = "";
  for (const col of visibleCols()) {
    const el = document.createElement("col");
    el.style.width = `${col[3] || 170}px`;
    colgroup.appendChild(el);
  }
  const thead = table.tHead;
  thead.innerHTML = "";
  const tr = document.createElement("tr");
  for (const [key, label, cls] of visibleCols()) {
    const th = document.createElement("th");
    th.textContent = label;
    const cc = document.createElement("span");
    cc.className = "colCopy";
    cc.textContent = "📋";
    cc.title = "Copy entire column";
    cc.addEventListener("click", e => {
      e.stopPropagation();
      const rows = currentRows();
      if (!rows.length) return;
      const vals = rows.map(r => tsvCell(cellValue(r, key, cls)));
      copyText(vals.join("\n"))
        .then(() => showToast(`Column "${label}" copied`))
        .catch(() => showToast("Copy failed", "error"));
    });
    th.appendChild(cc);
    if (key === sortKey) th.classList.add("sorted", ...(sortDir === -1 ? ["desc"] : []));
    th.addEventListener("click", () => {
      if (sortKey === key) dataStore.setState({ sortDir: -sortDir });
      else dataStore.setState({ sortKey: key, sortDir: 1 });
      buildHead();
      render();
    });
    tr.appendChild(th);
  }
  thead.appendChild(tr);
}

function currentRows() {
  const { data, sortKey, sortDir } = st();
  let rows = [...data.rows];
  const q = $("search").value.trim().toLowerCase();
  if (q) {
    rows = rows.filter(r =>
      COLUMNS.some(([k]) => String(r[k] ?? "").toLowerCase().includes(q))
    );
  }
  if (sortKey) {
    rows.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      const na = Number(va), nb = Number(vb);
      if (Number.isFinite(na) && Number.isFinite(nb) && va !== "" && vb !== "") {
        return (na - nb) * sortDir;
      }
      return String(va ?? "").localeCompare(String(vb ?? ""), undefined, { numeric: true }) * sortDir;
    });
  }
  return rows;
}

function fmtInstant(v, row) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const off = rowOffsetMs(row, st().snOffsetMs);
  const s = new Date(d.getTime() + off);
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())} ` +
    `${pad2(s.getUTCHours())}:${pad2(s.getUTCMinutes())}:${pad2(s.getUTCSeconds())}`;
}

function buildTableRows(rows, cols, fmtInstant) {
  const frag = document.createDocumentFragment();
  const breachCounts = { r: 0, m: 0, rm: 0 };
  const typeCounts = {};
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.dataset.sysId = String(row.sysId ?? "");
    const rep = buildReport(row, fmtInstant);
    const num = String(row.number ?? "");
    if (num) typeCounts[rep.type || "Other"] = (typeCounts[rep.type || "Other"] || 0) + 1;
    for (const [key, cls] of cols) {
      const td = document.createElement("td");
      if (cls) td.className = cls;
      let v;
      if (key.startsWith("rep:")) {
        v = rep[key.slice(4)] ?? "";
      } else {
        if (key !== "number") td.classList.add("editable");
        else td.classList.add("numLink");
        v = row[key];
        if (cls === "inst") v = fmtInstant(v, row);
        if ((cls === "time" || cls === "inst") && !v) td.classList.add("empty-time");
      }
      const text = v === null || v === undefined ? "" : String(v);
      td.textContent = cls ? text : cellShort(text);
      td.title = text ? `${text}${td.classList.contains("editable") ? "\n— double-click to edit" : ""}` : "";
      if (key === "number" && text.startsWith("INC")) {
        const stt = String(row.state ?? "").toLowerCase();
        if (stt.startsWith("close") || stt.startsWith("resolv")) {
          const breach = rep.slaBreach;
          if (breach) {
            td.classList.add("sla-breach-" + breach.toLowerCase());
            for (const ch of breach) { const k = ch.toLowerCase(); if (k in breachCounts) breachCounts[k]++; }
          }
        }
      }
      if (row.parseReview && (key === "solutionType" || key === "rootCause") && text) {
        td.classList.add("review");
        td.title = `⚠ Low-confidence parse — please verify\n\n${td.title}`;
      }
      const opts = td.classList.contains("editable") && text ? columnOptionList(key, row) : null;
      if (opts && opts.length && !opts.some(o => o.toLowerCase() === text.toLowerCase())) {
        td.classList.add("offlist");
        td.title = `Value not in the MSR option list\n\n${td.title}`;
      }
      tr.appendChild(td);
    }
    frag.appendChild(tr);
  }
  return { frag, breachCounts, typeCounts };
}

function updateFooter(data, rows, typeCounts, breachCounts) {
  $("count").textContent = `${rows.length} / ${data.rows.length} tickets`;
  const legend = $("slaBar");
  const parts = [];
  const typeKeys = Object.keys(typeCounts).sort();
  for (const t of typeKeys) parts.push(`<b>${typeCounts[t]}</b> ${t}`);
  const breachParts = [];
  if (breachCounts.rm) breachParts.push(`<span class="slaDot rm"></span>${breachCounts.rm} both SLAs`);
  if (breachCounts.r) breachParts.push(`<span class="slaDot r"></span>${breachCounts.r} response SLA`);
  if (breachCounts.m) breachParts.push(`<span class="slaDot m"></span>${breachCounts.m} resolution SLA`);
  if (breachParts.length) parts.push("SLA breached: " + breachParts.join(" · "));
  if (parts.length) { legend.innerHTML = parts.join(" · "); legend.classList.remove("hidden"); }
  else legend.classList.add("hidden");
}

function render() {
  const { data } = st();
  if (document.querySelector("td.edit-input")) return;
  const rows = currentRows();
  const tbody = $("tbl").tBodies[0];
  tbody.innerHTML = "";
  const cols = visibleCols();
  const { frag, breachCounts, typeCounts } = buildTableRows(rows, cols, fmtInstant);
  tbody.appendChild(frag);
  updateFooter(data, rows, typeCounts, breachCounts);
  applySelHighlight();
  renderSummary();
}

function scheduleSave() {
  clearTimeout(st().saveTimer);
  dataStore.setState({ saveTimer: setTimeout(saveData, 350) });
}

async function saveData() {
  const { data, saveTimer } = st();
  if (saveTimer) { clearTimeout(saveTimer); dataStore.setState({ saveTimer: null }); }
  if (!data) return;
  attachSummaryToData(data);
  setSelfPush(true);
  await chrome.storage.local.set({ [STORAGE.lastData]: data });
  setTimeout(() => setSelfPush(false), 300);
  renderSummary();
}

async function persistEdits() {
  const { data } = st();
  if (!data) return;
  attachSummaryToData(data);
  setSelfPush(true);
  try {
    await chrome.storage.local.set({ [STORAGE.lastData]: data });
  } catch (err) {
    setStatus(`Save failed: ${err.message}`, true);
  }
  setTimeout(() => setSelfPush(false), 300);
  renderSummary();
}

function parseLocalInput(text) {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  }
  const dmy = t.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmy) {
    return new Date(+dmy[3], +dmy[2] - 1, +dmy[1], +(dmy[4] || 0), +(dmy[5] || 0), +(dmy[6] || 0));
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

function getData() {
  return st().data;
}

function getTotalRows() {
  const data = st().data;
  return data ? data.rows.length : 0;
}

function hasDataRows() {
  const data = st().data;
  return !!(data && data.rows.length);
}

function findRowBySysId(sysId) {
  const data = st().data;
  return data.rows.find(r => String(r.sysId ?? "") === String(sysId ?? ""));
}

function displayedValue(row, key, cls) {
  const v = row[key];
  if (cls === "inst") return fmtInstant(v, row);
  return v === null || v === undefined ? "" : String(v);
}

function autoParse() {
  const data = st().data;
  if (!data || !Array.isArray(data.rows)) return 0;
  let filled = 0, withNotes = 0;
  for (const row of data.rows) {
    if (!(row.closeNotes || "").trim()) continue;
    withNotes++;
    if (row.solutionType && row.rootCause) continue;
    const h = extractHeuristic(row.closeNotes);
    if (h.solutionType || h.rootCause) {
      row.solutionType = row.solutionType || h.solutionType;
      row.rootCause = row.rootCause || h.rootCause;
      const conf = h.confidence;
      if ((h.solutionType && conf?.solutionType !== "high") || (h.rootCause && conf?.rootCause !== "high")) {
        row.parseReview = true;
      }
      filled++;
    }
  }
  if (data.rows.length && !withNotes) {
    setStatus("No close notes / work notes / comments found on these tickets", true);
  } else if (filled) {
    showToast(`Extracted resolution details from ${filled} ticket${filled === 1 ? "" : "s"}`);
  }
  return filled;
}

export {
  load,
  buildHead,
  currentRows,
  fmtInstant,
  render,
  scheduleSave,
  persistEdits,
  saveData,
  parseLocalInput,
  getData,
  getTotalRows,
  hasDataRows,
  findRowBySysId,
  displayedValue,
  autoParse
};

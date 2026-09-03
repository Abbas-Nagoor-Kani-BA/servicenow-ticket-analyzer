import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  seedAll, seed, peek, flush, installSkeleton, getLastCopied, getDownloads, clearDownloads
} from "./helpers/dom-env.mjs";
import fflate from "../lib/vendor/fflate.cjs";
import { setFflate } from "../core/templatexml.ts";

const FIXTURE = {
  lastData: {
    at: "2026-08-25T10:00:00Z",
    instance: "https://test.service-now.com",
    missingAudit: 0,
    totalPulled: 2,
    rows: [
      {
        sysId: "aaa", number: "INC0001001", shortDescription: "First ticket",
        state: "Closed", stateValue: "7", priority: "3 - Moderate",
        assignmentGroup: "APPSUP_TEST", assignedTo: "John Doe",
        configItem: "", createdOn: "01-08-2026 10:00:00",
        closeNotes: "root cause: stale cache on replicas",
        solutionType: "", workNotes: ""
      },
      {
        sysId: "bbb", number: "INC0001002", shortDescription: "Second ticket",
        state: "In Progress", stateValue: "2", priority: "4 - Low",
        assignmentGroup: "APPSUP_TEST", assignedTo: "",
        createdOn: "02-08-2026 11:00:00", closeNotes: ""
      }
    ],
    runs: [{ at: "2026-08-25T10:00:00Z", table: "incident", group: "APPSUP_TEST", pulled: 2 }]
  },
  pluginSettings: {
    defaults: { ticketType: "incident", queues: ["APPSUP_TEST"], teamMembers: ["John Doe", "Jane Smith"] }
  },
  msrLists: undefined,
  viewerHiddenCols: [],
  viewerSel: null
};

let grid, clipboard;

before(async () => {
  installSkeleton();
  seedAll(FIXTURE);
  await import("../surfaces/viewer/index.ts");
  grid = await import("../surfaces/viewer/grid.ts");
  clipboard = await import("../surfaces/viewer/clipboard.ts");
  await flush();
});

after(async () => { /* keep store for post-run inspection if needed */ });

test("modules registered and initial pull auto-rendered", { timeout: 8000 }, async () => {
  assert.equal(typeof grid.load, "function");
  assert.equal(typeof grid.render, "function");
  assert.equal(typeof clipboard.buildMsrTsv, "function");
  const count = document.getElementById("count").textContent;
  assert.match(count, /2 \/ 2 tickets/);
  const tbody = document.querySelector("#tbl tbody");
  assert.ok(tbody.children.length >= 1, "tbody has rendered rows");
});

test("search filter narrows the view", { timeout: 8000 }, async () => {
  const search = document.getElementById("search");
  search.value = "First";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await flush();
  assert.match(document.getElementById("count").textContent, /1 \/ 2/);
  search.value = "";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await flush();
  assert.match(document.getElementById("count").textContent, /2 \/ 2/);
});

test("column header click sorts by that column", { timeout: 8000 }, async () => {
  const ths = document.querySelectorAll("#tbl thead th");
  const idx = [...ths].findIndex(t => t.textContent.includes("Number"));
  ths[idx].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await flush();
  const firstNum = document.querySelector("#tbl tbody tr td").textContent;
  assert.ok(/^INC/.test(firstNum), "first cell is a ticket number after sort");
});

test("grid body is permanently read-only (no inline editor on double-click)", { timeout: 8000 }, async () => {
  const tr = document.querySelector("#tbl tbody tr");
  const prioIdx = [...document.querySelectorAll("#tbl thead th")]
    .findIndex(t => t.textContent.toLowerCase().includes("priority"));
  const td = tr.children[prioIdx];
  assert.ok(td.classList.contains("calclens-cell"), "every body cell carries the calclens-cell class");
  assert.ok(!td.classList.contains("editable"), "no editable cell path remains");
  td.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
  await flush();
  assert.equal(td.querySelector("input"), null, "double-click does not open an inline editor");
  assert.equal(td.textContent.trim(), "3 - Moderate", "cell content unchanged");
});

test("Calclens date input does not persist until Save is clicked", { timeout: 8000 }, async () => {
  const calState = await import("../surfaces/viewer/calclens-state.ts");
  calState.setCalclensMode(true);
  const row = grid.findRowBySysId("aaa");
  row.assignTimeUtcIso = "";
  grid.reportCellFocus({ sysId: "aaa", key: "assignTimeUtcIso" });
  await flush();
  const body = document.getElementById("calclensBody");
  assert.ok(body.querySelector(".calclens-edit-input.tlDate"), "drawer offers a date editor for a derivation column");
  const input = body.querySelector(".calclens-edit-input.tlDate");
  input.value = "05-08-2026 09:30:00";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await flush();
  const iso = new Date(2026, 7, 5, 9, 30, 0).toISOString();
  assert.equal(row.assignTimeUtcIso, "", "row unchanged until Save");
  assert.notEqual(peek("lastData").rows.find(r => r.sysId === "aaa").assignTimeUtcIso, iso,
    "not persisted before Save");
  const saveBtn = body.querySelector(".calclens-edit-save");
  assert.ok(saveBtn, "a Save button is offered");
  saveBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 500)); // debounce scheduleSave
  assert.equal(row.assignTimeUtcIso, iso, "assignTime written as ISO after Save");
  const stored = peek("lastData").rows.find(r => r.sysId === "aaa");
  assert.equal(stored.assignTimeUtcIso, iso, "drawer edit persisted to chrome.storage.lastData");
  const cell = document.querySelector("#tbl tbody tr[data-sys-id='aaa']");
  const assignIdx = [...document.querySelectorAll("#tbl thead th")]
    .findIndex(t => t.textContent.trim() === "Assign time");
  assert.ok(cell.children[assignIdx].textContent.length > 0, "grid re-rendered with the edited timeline time");
  calState.setCalclensMode(false);
});

test("Calclens timeline pick stages a time and only Save persists + toasts", { timeout: 8000 }, async () => {
  const calState = await import("../surfaces/viewer/calclens-state.ts");
  const row = grid.findRowBySysId("aaa");
  row.assignTimeUtcIso = "";
  row.activity = [
    { f: "state", o: "New", n: "On Hold", atEpoch: Date.UTC(2026, 7, 5, 8, 0, 0) },
    { f: "state", o: "On Hold", n: "In Progress", atEpoch: Date.UTC(2026, 7, 5, 11, 15, 0) }
  ];
  calState.setCalclensMode(true);
  grid.reportCellFocus({ sysId: "aaa", key: "assignTimeUtcIso" });
  await flush();
  const body = document.getElementById("calclensBody");
  const tlRows = body.querySelectorAll(".calclens-tl-row.pickable");
  assert.equal(tlRows.length, 2, "every timeline row is clickable");
  const pickIso = new Date(2026, 7, 5, 11, 15, 0).toISOString();
  const pickRow = [...tlRows].find(r => r.querySelector(".calclens-tl-change").textContent.includes("In Progress"));
  assert.ok(pickRow, "a row for the state->In Progress change exists");
  pickRow.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await flush();
  assert.equal(document.querySelector(".calclens-tl-row.selected .calclens-tl-time").textContent,
    "05-08-2026 11:15:00", "clicking a timeline row highlights it as selected");
  assert.equal(row.assignTimeUtcIso, "", "picking a row does not write the row in memory");
  assert.notEqual(peek("lastData").rows.find(r => r.sysId === "aaa").assignTimeUtcIso, pickIso,
    "not persisted before Save");
  body.querySelector(".calclens-edit-save").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await new Promise(r => setTimeout(r, 500)); // debounce scheduleSave
  const stored = peek("lastData").rows.find(r => r.sysId === "aaa");
  assert.equal(stored.assignTimeUtcIso, pickIso, "pick persisted after Save");
  const toastTxt = [...document.querySelectorAll(".toast")].map(t => t.textContent).join(" | ");
  assert.match(toastTxt, /Saved/, "a Saved toast confirms the edit");
  calState.setCalclensMode(false);
});

test("clicking a key-moment chip jumps to the derived cell and opens its editor", { timeout: 8000 }, async () => {
  const calState = await import("../surfaces/viewer/calclens-state.ts");
  const selection = await import("../surfaces/viewer/selection.ts");
  const row = grid.findRowBySysId("aaa");
  const iso = (u) => new Date(u).toISOString();
  row.assignTimeUtcIso = iso(Date.UTC(2026, 7, 25, 9, 15, 0));
  row.acknTimeUtcIso = iso(Date.UTC(2026, 7, 25, 9, 35, 0));
  row.suspendTimeUtcIso = iso(Date.UTC(2026, 7, 25, 10, 0, 0));
  row.resumeTimeUtcIso = iso(Date.UTC(2026, 7, 25, 11, 30, 0));
  row.activity = [
    { f: "assignment_group", o: "APPSUP_TEST", n: "APPSUP_TEST", atEpoch: Date.UTC(2026, 7, 25, 9, 15, 0) },
    { f: "assigned_to", o: "", n: "John Doe", atEpoch: Date.UTC(2026, 7, 25, 9, 35, 0) },
    { f: "state", o: "2", n: "3", atEpoch: Date.UTC(2026, 7, 25, 10, 0, 0) },
    { f: "state", o: "3", n: "2", atEpoch: Date.UTC(2026, 7, 25, 11, 30, 0) }
  ];
  calState.setCalclensMode(true);
  grid.reportCellFocus({ sysId: "aaa", key: "state" });
  await flush();
  const body = document.getElementById("calclensBody");
  const chip = body.querySelector("button.calclens-tl-mark");
  assert.ok(chip, "a clickable key-moment chip is rendered for a static column");
  chip.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await flush();

  assert.equal(selection.getSelFocus()?.key, "assignTimeUtcIso", "grid focus jumped to the Assign time cell");
  assert.equal(selection.getSelFocus()?.sysId, "aaa", "same row is focused");
  const body2 = document.getElementById("calclensBody");
  assert.ok(body2.querySelector(".calclens-edit-input.tlDate"), "derived time editor is now shown");
  calState.setCalclensMode(false);
});

test("Calclens groups same-timestamp changes under one timeline node", { timeout: 8000 }, async () => {
  const calState = await import("../surfaces/viewer/calclens-state.ts");
  const row = grid.findRowBySysId("aaa");
  const sameEpoch = Date.UTC(2026, 7, 5, 11, 15, 0);
  row.assignTimeUtcIso = "";
  row.activity = [
    { f: "state", o: "New", n: "On Hold", atEpoch: Date.UTC(2026, 7, 5, 8, 0, 0) },
    { f: "assignment_group", o: "APPSUP_TEST", n: "PAYMENTS", atEpoch: sameEpoch },
    { f: "state", o: "On Hold", n: "In Progress", atEpoch: sameEpoch }
  ];
  calState.setCalclensMode(true);
  grid.reportCellFocus({ sysId: "aaa", key: "assignTimeUtcIso" });
  await flush();
  const body = document.getElementById("calclensBody");
  const tlRows = body.querySelectorAll(".calclens-tl-row.pickable");
  assert.equal(tlRows.length, 2, "two distinct timestamps => two grouped nodes");
  const groups = [...tlRows].map(r => r.querySelectorAll(".calclens-tl-change").length);
  assert.deepEqual(groups.map(String).sort(), ["1", "2"], "the shared timestamp appears once with two changes");
  const clockIcons = body.querySelectorAll(".calclens-tl-row .calclens-tl-icn[data-icon='clock']");
  assert.equal(clockIcons.length, 2, "each grouped node shows a clock icon");
  calState.setCalclensMode(false);
});

test("Calclens timeline shows empty old value as 'empty'", { timeout: 8000 }, async () => {
  const calState = await import("../surfaces/viewer/calclens-state.ts");
  const row = grid.findRowBySysId("aaa");
  row.assignTimeUtcIso = "";
  row.activity = [
    { f: "assigned_to", o: "", n: "John Doe", atEpoch: Date.UTC(2026, 7, 5, 9, 0, 0) }
  ];
  calState.setCalclensMode(true);
  grid.reportCellFocus({ sysId: "aaa", key: "acknTimeUtcIso" });
  await flush();
  const body = document.getElementById("calclensBody");
  const change = body.querySelector(".calclens-tl-change");
  assert.ok(change, "a change line exists");
  const desc = change.querySelector(".calclens-tl-desc");
  const label = desc.querySelector(".calclens-tl-desc-label").textContent;
  const values = [...desc.querySelectorAll(".calclens-tl-desc-value")].map(v => v.textContent);
  assert.equal(label, "Assigned to:", "field label rendered");
  assert.deepEqual(values, ["empty", "John Doe"], "empty old value shown as 'empty'");
  calState.setCalclensMode(false);
});

test("Calclens discards an unsaved pick when moving to the next cell", { timeout: 8000 }, async () => {
  const calState = await import("../surfaces/viewer/calclens-state.ts");
  const row = grid.findRowBySysId("bbb");
  row.assignTimeUtcIso = "";
  row.activity = [
    { f: "assignment_group", o: "APPSUP_TEST", n: "PAYMENTS", atEpoch: Date.UTC(2026, 7, 5, 9, 30, 0) }
  ];
  calState.setCalclensMode(true);
  grid.reportCellFocus({ sysId: "bbb", key: "assignTimeUtcIso" });
  await flush();
  const body = document.getElementById("calclensBody");
  const pickRow = [...body.querySelectorAll(".calclens-tl-row.pickable")][0];
  pickRow.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await flush();
  assert.equal(row.assignTimeUtcIso, "", "staged in memory only");
  grid.reportCellFocus({ sysId: "bbb", key: "acknTimeUtcIso" });
  await flush();
  await new Promise(r => setTimeout(r, 500)); // debounce scheduleSave
  assert.notEqual(peek("lastData").rows.find(r => r.sysId === "bbb").assignTimeUtcIso, new Date(2026, 7, 5, 9, 30, 0).toISOString(),
    "moving to the next cell without Save does not persist the pick");
  calState.setCalclensMode(false);
});

test("Calclens drawer shows a choice picker but not a date editor for solutionType", { timeout: 8000 }, async () => {
  const calState = await import("../surfaces/viewer/calclens-state.ts");
  calState.setCalclensMode(true);
  grid.reportCellFocus({ sysId: "aaa", key: "solutionType" });
  await flush();
  const body = document.getElementById("calclensBody");
  const section = body.querySelector(".calclens-edit");
  assert.ok(section, "drawer offers an edit section for solutionType");
  assert.ok(section.querySelector("input.calclens-edit-input:not(.tlDate)"), "choice column renders a picker input");
  assert.equal(section.querySelector(".calclens-edit-input.tlDate"), null, "no date editor for a choice column");
  calState.setCalclensMode(false);
});

test("Calclens drawer does not offer editing for non-derivation columns", { timeout: 8000 }, async () => {
  const calState = await import("../surfaces/viewer/calclens-state.ts");
  calState.setCalclensMode(true);
  grid.reportCellFocus({ sysId: "aaa", key: "shortDescription" });
  await flush();
  const body = document.getElementById("calclensBody");
  assert.equal(body.querySelector(".calclens-edit"), null, "no edit section for a read-only column");
  calState.setCalclensMode(false);
});

test("Calclens ON flags attention cells with a marker and tooltip", { timeout: 8000 }, async () => {
  const calState = await import("../surfaces/viewer/calclens-state.ts");
  const row = grid.currentRows()[0];
  row.rootCause = "";
  row.solutionType = "";
  calState.setCalclensMode(true);
  grid.render();
  await flush();
  const flagged = document.querySelector(`#tbl tbody tr[data-sys-id="aaa"]`);
  assert.ok(!flagged.classList.contains("attention"), "row carries no row-level attention class");
  const marked = [...flagged.querySelectorAll("td.attention-mark")];
  assert.ok(marked.length >= 2, "hinted cells show the attention marker (rootCause + solutionType)");
  for (const cell of marked) {
    const tip = (cell.getAttribute("data-tip") ?? "");
    assert.ok(tip.includes("Needs attention") && tip.includes("Missing plan data"), "marked cell tooltip lists the fired rule and detail");
  }
  calState.setCalclensMode(false);
  grid.render();
  await flush();
  assert.equal(document.querySelector("#tbl tbody td.attention-mark"), null, "markers cleared when Calclens is toggled off");
});

test("disabling a highlight suppresses the mark but keeps the tooltip", { timeout: 8000 }, async () => {
  const calState = await import("../surfaces/viewer/calclens-state.ts");
  const hl = await import("../surfaces/viewer/calclens-highlights.ts");
  const row = grid.currentRows()[0];
  row.rootCause = "";
  row.solutionType = "";

  calState.setCalclensMode(true);
  hl.setHighlightEnabled("emptyPlan", false);
  grid.render();
  await flush();

  const flagged = document.querySelector(`#tbl tbody tr[data-sys-id="aaa"]`);
  assert.equal(flagged.querySelector("td.attention-mark"), null, "disabled highlight paints no mark");
  const withTip = [...flagged.querySelectorAll("td")].filter((td) =>
    (td.getAttribute("data-tip") ?? "").includes("Missing plan data"));
  assert.ok(withTip.length >= 2, "tooltip still lists the reason on the hinted cells");

  // Re-enable through the owner: the mark returns.
  hl.setHighlightEnabled("emptyPlan", true);
  grid.render();
  await flush();
  assert.ok(document.querySelectorAll(`#tbl tbody tr[data-sys-id="aaa"] td.attention-mark`).length >= 2,
    "re-enabling restores the mark");

  calState.setCalclensMode(false);
  grid.render();
  await flush();
});

test("tooltip hides when the hovered cell is re-rendered", { timeout: 8000 }, async () => {
  const cell = document.querySelector(`#tbl tbody tr[data-sys-id="aaa"] td`);
  assert.ok(cell, "a body cell exists to hover");
  cell.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true, clientX: 300, clientY: 100 }));
  const tipIn = () => {
    const t = document.querySelector(".tip");
    return !!t && t.classList.contains("in");
  };
  await new Promise((r) => setTimeout(r, 700)); // > SHOW_DELAY
  assert.ok(tipIn(), "tooltip shown while hovering the cell");
  grid.render();
  await flush();
  document.body.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true, clientX: 5, clientY: 5 }));
  await flush();
  assert.equal(tipIn(), false, "tooltip no longer stuck after the hovered cell is replaced");
});

test("classifyRows degrades to the scorer with a notice when the ML model is missing", { timeout: 8000 }, async () => {
  const { classifyRows } = await import("../surfaces/viewer/classify.ts");
  await chrome.storage.local.set({
    pluginSettings: {
      defaults: { ticketType: "incident", queues: ["APPSUP_TEST"], teamMembers: ["John Doe"] },
      ml: { mode: "ml", modelId: "mobilebert", cacheEnabled: true }
    }
  });
  const run = await classifyRows({ onProgress: () => {}, onStats: () => {}, updateRow: () => {} });
  assert.ok(run.notice && run.notice.includes("not downloaded"), "reports the missing model to the user");
  assert.equal(typeof run.changed, "number", "the degrade pass still completes");
});

test("single-cell selection + arrow navigation focuses the selected cell", { timeout: 8000 }, async () => {
  const calState = await import("../surfaces/viewer/calclens-state.ts");
  const selModule = await import("../surfaces/viewer/selection.ts");
  calState.setCalclensMode(true);
  await selModule.setSelPoint("aaa", "number", false);
  await flush();
  const numTd = document.querySelector(`#tbl tbody tr[data-sys-id="aaa"]`).children[0];
  assert.ok(numTd.classList.contains("sel"), "selected cell is highlighted");
  assert.ok(!numTd.classList.contains("numLink"), "number cell is a plain read-only cell (no detail popup)");
  assert.equal(document.querySelector(".ticketPop"), null, "no ticket popup exists anymore");
  const numIdx = [...document.querySelectorAll("#tbl thead th")]
    .findIndex(t => t.textContent.trim() === "Number");
  const nextIdx = numIdx + 1;
  const rowAfter = grid.findRowBySysId("aaa");
  selModule.moveSel(0, 1, false);
  await flush();
  const selCol = [...document.querySelector(`#tbl tbody tr[data-sys-id="aaa"]`).children]
    .findIndex(td2 => td2.classList.contains("sel"));
  assert.equal(selCol, nextIdx, "arrow navigation moved the focus one cell right");
  assert.ok(rowAfter, "row still present after navigation");
  calState.setCalclensMode(false);
});

test("derived duration columns render HMS from the timeline stamps", { timeout: 8000 }, async () => {
  const row = grid.currentRows()[0];
  Object.assign(row, {
    assignTimeUtcIso: new Date(2026, 7, 5, 9, 0, 0).toISOString(),
    acknTimeUtcIso: new Date(2026, 7, 5, 9, 30, 0).toISOString(),
    suspendTimeUtcIso: new Date(2026, 7, 5, 10, 0, 0).toISOString(),
    resumeTimeUtcIso: new Date(2026, 7, 5, 11, 15, 0).toISOString(),
    resolvedAtRaw: "2026-08-05 17:00:00"
  });
  grid.render();
  await flush();
  const ths = [...document.querySelectorAll("#tbl thead th")];
  const idxOf = (label: string) => ths.findIndex(t => t.textContent === label);
  const cells = [...document.querySelector("#tbl tbody tr").children];
  assert.equal(cells[idxOf("Time to ackn")].textContent, "0:30:00", "assign->ackn rendered as HMS");
  assert.equal(cells[idxOf("Time to resolve")].textContent, "8:00:00", "assign->resolve rendered as HMS");
  assert.equal(cells[idxOf("Suspend total")].textContent, "1:15:00", "suspend total rendered as HMS");
});

test("clicking a body cell reports it to Calclens (single-cell focus)", { timeout: 8000 }, async () => {
  const calState = await import("../surfaces/viewer/calclens-state.ts");
  calState.setCalclensMode(true);
  const numTd = document.querySelector(`#tbl tbody tr[data-sys-id="bbb"]`).children[0];
  numTd.dispatchEvent(new window.MouseEvent("click", { bubbles: true, button: 0 }));
  await flush();
  const body = document.getElementById("calclensBody");
  assert.ok(body && body.textContent.length > 0, "Calclens panel populated after cell click");
  assert.equal(document.querySelector(".ticketPop"), null, "cell click never opens a ticket popup");
  calState.setCalclensMode(false);
});

test("summary SLA tab renders counts and persists summarySla", { timeout: 8000 }, async () => {
  const tabSummary = document.getElementById("tabSummary");
  const tabTickets = document.getElementById("tabTickets");
  const stored = peek("lastData");
  assert.ok(stored.summarySla, "summarySla persisted to lastData on load");
  assert.equal(stored.summarySla.items.length, 17, "17 summary items persisted");
  const liveTotals = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const r of grid.currentRows()) {
    const st = String(r.state ?? "").toLowerCase();
    const eligible = /^INC/.test(r.number) && (st.startsWith("close") || st.startsWith("resolv"));
    if (eligible) liveTotals[parseInt(r.priority)]++;
  }
  assert.deepEqual(stored.summarySla.incidentTotals, liveTotals, "incident totals by severity (closed/resolved incidents only)");

  tabSummary.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await flush();
  assert.ok(!document.getElementById("summaryWrap").classList.contains("hidden"), "summary panel visible");
  assert.ok(document.getElementById("wrap").classList.contains("hidden"), "ticket table hidden");
  const incRows = document.querySelectorAll("#sumIncTbl tbody tr");
  const probRows = document.querySelectorAll("#sumProbTbl tbody tr");
  assert.equal(incRows.length, 14, "14 incident rows in summary table");
  assert.equal(probRows.length, 3, "3 problem rows in summary table");
  assert.match(document.getElementById("sumMeta").textContent,
    new RegExp(`P1 ${liveTotals[1]}, P2 ${liveTotals[2]}, P3 ${liveTotals[3]}, P4 ${liveTotals[4]}`));
  assert.equal(incRows[0].children[0].rowSpan, 10, "Time to Resolve spans severity rows");
  assert.equal(incRows[0].children[3].className, "sla", "sla label rendered");
  assert.match(incRows[0].children[8].textContent, /GREEN|AMBER|RED/);
  assert.ok(probRows[0].children[7].textContent.length > 0, "problem total rendered");

  tabTickets.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await flush();
  assert.ok(document.getElementById("wrap").classList.contains("hidden") === false, "tickets view restored");
  assert.ok(document.getElementById("summaryWrap").classList.contains("hidden"), "summary panel hidden again");
});

test("summary SLA tab reflects the active search filter", { timeout: 8000 }, async () => {
  const tabSummary = document.getElementById("tabSummary");
  const tabTickets = document.getElementById("tabTickets");
  const search = document.getElementById("search");
  search.value = "Second";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await flush();
  tabSummary.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await flush();
  const incRows = document.querySelectorAll("#sumIncTbl tbody tr");
  assert.equal(incRows.length, 14, "14 incident rows still rendered");
  const totalFor = label => {
    const tr = [...incRows].find(r => r.dataset.sla === label);
    return tr ? (tr.querySelector("td.total")?.textContent ?? null) : null;
  };
  assert.equal(totalFor("Within 10 working days"), "0", "P4 resolve total excludes the open (In Progress) ticket");
  assert.equal(totalFor("Within 1 hour"), "0", "P1 resolve total empty");
  assert.equal(totalFor("Within 3 business hours"), "0", "P4 respond total excludes the open ticket");
  assert.match(document.getElementById("sumMeta").textContent,
    /P1 0, P2 0, P3 0, P4 0/);
  assert.match(document.getElementById("sumMeta").textContent,
    /showing 1 of 2 tickets/);
  tabTickets.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  search.value = "";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await flush();
});

test("buildMsrTsv emits exactly 21 MSR columns with blanks preserved", () => {
  const rows = grid.currentRows();
  for (const line of clipboard.buildMsrTsv(rows).split("\n")) {
    assert.equal(line.split("\t").length, 21, "21 tab-separated fields per row");
  }
  const secondHasBlanks = clipboard.buildMsrTsv([rows[1]]).includes("\t\t");
  assert.ok(secondHasBlanks || !rows[1].assignedTo, "empty cells stay empty tabs");
});

test("copy-for-msr button copies current view", { timeout: 8000 }, async () => {
  const btn = document.getElementById("copyMsrBtn");
  const before = grid.currentRows();
  btn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await flush();
  assert.ok(getLastCopied(), "clipboard received TSV");
  assert.equal(getLastCopied().split("\n").length, before.length);
  const toastTxt = [...document.querySelectorAll(".toast")].map(t => t.textContent).join(" | ");
  assert.match(toastTxt, new RegExp(`Copied ${before.length} row`), "toast confirms the copy");
});

test("split radios default to single file when split is off", async () => {
  const radSingle = document.getElementById("radSingle");
  const radSplit = document.getElementById("radSplit");
  assert.equal(radSingle.checked, true);
  assert.equal(radSplit.checked, false);
});

test("selecting 'Separate files' with groups persists enabled and flips radios", async () => {
  const toolbar = await import("../surfaces/viewer/toolbar.ts");
  toolbar.setCiSplit({ enabled: false, groups: [{ name: "Appsupp", items: ["App"] }] });
  toolbar.syncSplitRadio();
  const radSingle = document.getElementById("radSingle");
  const radSplit = document.getElementById("radSplit");
  radSplit.checked = true;
  radSplit.dispatchEvent(new window.Event("change", { bubbles: true }));
  await flush();
  assert.equal(peek("ciSplit").enabled, true, "split enabled persisted");
  assert.equal(radSplit.checked, true);
  assert.equal(radSingle.checked, false, "single file unchecked");
});

test("selecting 'Single file' while split is active disables and persists", async () => {
  const toolbar = await import("../surfaces/viewer/toolbar.ts");
  toolbar.setCiSplit({ enabled: true, groups: [{ name: "Appsupp", items: ["App"] }] });
  toolbar.syncSplitRadio();
  const radSingle = document.getElementById("radSingle");
  radSingle.checked = true;
  radSingle.dispatchEvent(new window.Event("change", { bubbles: true }));
  await flush();
  assert.equal(peek("ciSplit").enabled, false, "split disabled persisted");
  assert.equal(document.getElementById("radSplit").checked, false);
});

test("selecting 'Separate files' with no groups opens the CI dialog and reverts", async () => {
  const toolbar = await import("../surfaces/viewer/toolbar.ts");
  toolbar.setCiSplit({ enabled: false, groups: [] });
  toolbar.syncSplitRadio();
  const radSplit = document.getElementById("radSplit");
  radSplit.checked = true;
  radSplit.dispatchEvent(new window.Event("change", { bubbles: true }));
  await flush();
  assert.equal(radSplit.checked, false, "radio reverted to single");
  assert.equal(document.getElementById("radSingle").checked, true);
  assert.ok(!document.getElementById("ciModal").classList.contains("hidden"),
    "CI dialog opened to configure groups");
  document.getElementById("ciClose").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await flush();
  assert.ok(document.getElementById("ciModal").classList.contains("hidden"));
  assert.equal(document.getElementById("radSingle").checked, true, "cancel keeps single file");
});

test("split export writes one file per CI group (serialized downloads)", { timeout: 8000 }, async () => {
  const enc = s => new TextEncoder().encode(s);
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="All_Ticket_Details" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:E3"/>
<sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>S.No</t></is></c><c r="E1" t="inlineStr"><is><t>Reference Number</t></is></c></row>
<row r="2"><c r="A2" s="4"/><c r="E2" s="7" t="inlineStr"><is><t>INCOLD</t></is></c></row>
</sheetData></worksheet>`;
  const fixtureBuf = fflate.zipSync({
    "[Content_Types].xml": enc(ct),
    "_rels/.rels": enc(rootRels),
    "xl/workbook.xml": enc(wb),
    "xl/_rels/workbook.xml.rels": enc(wbRels),
    "xl/worksheets/sheet1.xml": enc(sheet)
  }, { level: 0 });
  const b64 = Buffer.from(fixtureBuf).toString("base64");

  setFflate(fflate);
  globalThis.fflate = fflate;

  const withCIs = JSON.parse(JSON.stringify(FIXTURE));
  withCIs.lastData.rows[0].configItem = "Payment Gateway";
  withCIs.lastData.rows[1].configItem = "Identity Platform";
  seed("lastData", withCIs.lastData);
  grid.load(withCIs.lastData);
  await flush();
  seed("snXlsxTemplate", { name: "report-template.xlsx", dataB64: b64, savedAt: Date.now() });

  const toolbar = await import("../surfaces/viewer/toolbar.ts");
  toolbar.setCiSplit({
    enabled: true,
    groups: [
      { name: "Payments", items: ["Payment Gateway"] },
      { name: "Identity", items: ["Identity Platform"] }
    ]
  });
  clearDownloads();
  await toolbar.loadTplInfo();
  await toolbar.runExport();
  await flush();

  const dl = getDownloads();
  assert.equal(dl.length, 2, "one download requested per CI group");
  assert.ok(dl[0].filename !== dl[1].filename, "distinct filenames per group");
  assert.match(dl.map(d => d.filename).join(","), /Payments/, "Payments group file present");
  assert.match(dl.map(d => d.filename).join(","), /Identity/, "Identity group file present");
  assert.equal(dl.every(d => d.saveAs === false), true, "no save-as prompts for split files");
});

test("buildCiGroups splits on contained keywords, not just start-prefixes", async () => {
  const toolbar = await import("../surfaces/viewer/toolbar.ts");
  toolbar.setCiSplit({
    enabled: true,
    groups: [
      { name: "Payments", items: ["Payment Gateway", "Payment"] },
      { name: "Identity", items: ["Identity Platform"] },
      { name: "Network", items: ["Network"] }
    ]
  });
  const rows = [
    { configItem: "Gateway Payment" },
    { configItem: "Web Payment Gateway" },
    { configItem: "Prod Identity Platform" },
    { configItem: "Core Network" },
    { configItem: "Unrelated Zebra" }
  ];
  const groups = toolbar.buildCiGroups(rows);
  const names = groups.map(g => `${g.name}:${g.rows.length}`).join(",");
  assert.match(names, /Payments:2/, "Payment rows matched by substring despite word order");
  assert.match(names, /Identity:1/, "Identity row matched");
  assert.match(names, /Network:1/, "Network row matched");
  assert.match(names, /Others:1/, "genuinely unmatched row falls back to Others");
  assert.equal(groups.length, 4, "three groups plus Others = four buckets, not one");
});

test("split preview in config popup shows per-group ticket counts", async () => {
  const toolbar = await import("../surfaces/viewer/toolbar.ts");
  const rows = grid.currentRows();
  rows.forEach(r => { r.configItem = ""; });
  rows[0].configItem = "Payment Gateway PRD";
  rows[1].configItem = "Identity Platform";

  toolbar.setCiSplit({
    enabled: true,
    groups: [
      { name: "Payments", items: ["Payment Gateway"] },
      { name: "Identity", items: ["Identity Platform"] }
    ]
  });
  toolbar.updateConfigSummary();
  await flush();

  const preview = document.getElementById("cfgSplitPreview");
  assert.ok(!preview.classList.contains("hidden"), "preview visible when split enabled");
  const rowsText = [...preview.querySelectorAll(".pvRow")].map(r => r.textContent);
  const joined = rowsText.join("|");
  assert.match(joined, /Payments\s*1/, "Payments group shows its count");
  assert.match(joined, /Identity\s*1/, "Identity group shows its count");
  assert.match(joined, /Will export 2 rows as 2 files/, "header summarizes totals");
  assert.doesNotMatch(joined, /no matching rows/, "no empty-group hint when both match");
});

test("cell copy/paste/undo are disabled: no fill handle and body edits are blocked", { timeout: 8000 }, async () => {
  const selModule = await import("../surfaces/viewer/selection.ts");
  assert.equal(document.getElementById("fillHandle"), null, "fill handle element removed");
  assert.equal(document.querySelector("#tbl.selecting"), null, "no range-select mode class exists");
  await selModule.setSelPoint("aaa", "shortDescription", false);
  await flush();
  document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true }));
  await flush();
  document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true }));
  await flush();
  document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
  await flush();
  assert.equal(grid.findRowBySysId("aaa").shortDescription, "First ticket", "Ctrl+C/V/Z leave the body untouched");
});

test("column-copy button removed from headers", async () => {
  const copyBtns = document.querySelectorAll("#tbl thead th .colCopy");
  assert.equal(copyBtns.length, 0, "no .colCopy button remains");
  const resizeHandles = document.querySelectorAll("#tbl thead th .colResize");
  assert.ok(resizeHandles.length > 0, "resize handles exist on headers");
});

test("persisted column width is applied by buildHead", async () => {
  const store = await import("../surfaces/viewer/store.ts");
  store.setColWidths({ shortDescription: 300 });
  grid.buildHead();
  const ths = document.querySelectorAll("#tbl thead th");
  const idx = [...ths].findIndex(t => t.textContent.trim() === "Short description");
  const col = document.querySelectorAll("#tbl colgroup col")[idx];
  assert.equal(col.style.width, "300px", "col width reflects persisted value");
});

test("dragging a column resize handle updates and persists the width", { timeout: 8000 }, async () => {
  const store = await import("../surfaces/viewer/store.ts");
  store.setColWidths({});
  grid.buildHead();
  const ths = document.querySelectorAll("#tbl thead th");
  const idx = [...ths].findIndex(t => t.textContent.trim() === "Short description");
  const handle = ths[idx].querySelector(".colResize");
  const col = document.querySelectorAll("#tbl colgroup col")[idx];
  const before = parseInt(col.style.width, 10);
  function fire(el, type, clientX) {
    const ev = new window.MouseEvent(type, { bubbles: true, clientX });
    el.dispatchEvent(ev);
  }
  fire(handle, "pointerdown", 0);
  fire(handle, "pointermove", 60);
  fire(handle, "pointerup", 60);
  await flush();
  assert.equal(parseInt(col.style.width, 10), before + 60, "col width changed by drag");
  assert.equal(store.getColWidths().shortDescription, before + 60, "width persisted to store");
});

test("clicking the resize handle does not trigger header sort", { timeout: 8000 }, async () => {
  const ths = document.querySelectorAll("#tbl thead th");
  const idx = [...ths].findIndex(t => t.textContent.trim() === "Short description");
  const before = ths[idx].className;
  const handle = ths[idx].querySelector(".colResize");
  handle.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await flush();
  assert.equal(ths[idx].className, before, "sort class unchanged by handle click");
});

test("reset widths clears persisted widths and reverts the column", async () => {
  const store = await import("../surfaces/viewer/store.ts");
  store.setColWidths({ shortDescription: 320 });
  grid.buildHead();
  grid.resetColWidths();
  await flush();
  assert.deepEqual(store.getColWidths(), {}, "persisted widths cleared");
  const ths = document.querySelectorAll("#tbl thead th");
  const idx = [...ths].findIndex(t => t.textContent.trim() === "Short description");
  const col = document.querySelectorAll("#tbl colgroup col")[idx];
  assert.equal(col.style.width, "150px", "column reverted to default width");
});

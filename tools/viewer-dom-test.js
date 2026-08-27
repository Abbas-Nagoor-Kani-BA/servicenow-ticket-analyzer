import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  seedAll, peek, flush, installSkeleton, getLastCopied
} from "./helpers/dom-env.mjs";

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
  msrLists: undefined,
  viewerHiddenCols: [],
  viewerSel: null
};

let grid, clipboard, ticketpop;

before(async () => {
  installSkeleton();
  seedAll(FIXTURE);
  await import("../viewer/js/viewer.js");
  grid = await import("../viewer/js/30-grid.js");
  clipboard = await import("../viewer/js/15-clipboard.js");
  ticketpop = await import("../viewer/js/50-ticketpop.js");
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

test("cell edit commits to row + persists via scheduleSave", { timeout: 8000 }, async () => {
  const tr = document.querySelector("#tbl tbody tr");
  const sysId = tr.dataset.sysId;
  const cols = [...tr.children];
  // Priority column index (visible order)
  const prioIdx = [...document.querySelectorAll("#tbl thead th")]
    .findIndex(t => t.textContent.toLowerCase().includes("priority"));
  const td = cols[prioIdx];
  td.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
  await flush();
  const input = td.querySelector("input");
  assert.ok(input, "inline editor opened");
  input.value = "2 - High";
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await new Promise(r => setTimeout(r, 500)); // debounce persistEdits
  const stored = peek("lastData");
  const saved = stored.rows.find(r => r.sysId === sysId);
  assert.equal(saved.priority, "2 - High", "persisted to chrome.storage.lastData");
  const rowNow = grid.findRowBySysId(sysId);
  assert.equal(rowNow.priority, "2 - High", "in-memory data updated");
  const cellText = document.querySelector(`#tbl tbody tr[data-sys-id="${sysId}"]`)
    .children[prioIdx].textContent;
  assert.equal(cellText, "2 - High", "grid re-rendered with new value");
});

test("option picker enforces strict list", { timeout: 8000 }, async () => {
  const tr = document.querySelector("#tbl tbody tr");
  const sysId = tr.dataset.sysId;
  const solIdx = [...document.querySelectorAll("#tbl thead th")]
    .findIndex(t => t.textContent.toLowerCase().includes("solution type"));
  const td = document.querySelector(`#tbl tbody tr[data-sys-id="${sysId}"]`).children[solIdx];
  td.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
  await flush();
  const pick = document.querySelector(".msrPick");
  assert.ok(pick, "picker popup opened");
  const searchIn = pick.querySelector(".msrPickSearch");
  searchIn.value = "zzz-not-an-option";
  searchIn.dispatchEvent(new window.Event("input", { bubbles: true }));
  await flush();
  searchIn.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await flush();
  const row = grid.findRowBySysId(sysId);
  assert.notEqual(row.solutionType, "zzz-not-an-option", "strict list rejected garbage");
  searchIn.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await flush();
  assert.equal(document.querySelector(".msrPick"), null, "popup closed after cancel path");
});

test("ticket popup edits timeline date in place", { timeout: 8000 }, async () => {
  const tr = document.querySelector("#tbl tbody tr");
  const row = grid.findRowBySysId(tr.dataset.sysId);
  ticketpop.openTicketPopup(row);
  await flush();
  const pop = document.querySelector(".ticketPop");
  assert.ok(pop, "ticket popup opened centered");
  const tlInputs = pop.querySelectorAll("input.tlDate");
  assert.equal(tlInputs.length, 4, "four timeline date inputs");
  const iso = new Date(2026, 7, 5, 9, 30, 0).toISOString();
  tlInputs[0].value = "05-08-2026 09:30:00";
  tlInputs[0].dispatchEvent(new window.Event("blur"));
  await new Promise(r => setTimeout(r, 500));
  assert.equal(row.assignTime, iso, "assignTime written as ISO");
  const stored = peek("lastData").rows.find(r => r.sysId === tr.dataset.sysId);
  assert.equal(stored.assignTime, iso, "persisted");
  const esc = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
  document.dispatchEvent(esc);
  await flush();
  assert.equal(document.querySelector(".ticketPop"), null, "Escape closed popup");
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
  assert.match(document.getElementById("status").textContent, /Copied \d+ row/);
});

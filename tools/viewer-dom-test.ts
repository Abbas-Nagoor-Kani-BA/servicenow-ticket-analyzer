import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  seedAll, seed, peek, flush, installSkeleton, getLastCopied, getDownloads, clearDownloads,
  setClipboardText, clearClipboardText
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
  msrLists: undefined,
  viewerHiddenCols: [],
  viewerSel: null
};

let grid, clipboard, ticketpop;

before(async () => {
  installSkeleton();
  seedAll(FIXTURE);
  await import("../surfaces/viewer/index.ts");
  grid = await import("../surfaces/viewer/grid.js");
  clipboard = await import("../surfaces/viewer/clipboard.js");
  ticketpop = await import("../surfaces/viewer/ticketpop.js");
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
  assert.equal(row.assignTimeUtcIso, iso, "assignTime written as ISO");
  const stored = peek("lastData").rows.find(r => r.sysId === tr.dataset.sysId);
  assert.equal(stored.assignTimeUtcIso, iso, "persisted");
  const esc = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
  document.dispatchEvent(esc);
  await flush();
  assert.equal(document.querySelector(".ticketPop"), null, "Escape closed popup");
});

test("number popup opens on click even when pointer capture retargets the event to tbody", { timeout: 8000 }, async () => {
  const tbody = document.querySelector("#tbl tbody");
  const numTd = Array.from(tbody.querySelector("tr").children)
    .find(td => td.classList.contains("numLink"));
  assert.ok(numTd, "numLink cell exists");
  const originalEqp = document.elementFromPoint;
  const hitTest = numTd;
  document.elementFromPoint = (x, y) => {
    assert.equal(x, 42);
    return hitTest;
  };
  try {
    tbody.dispatchEvent(new window.MouseEvent("click", {
      bubbles: true, cancelable: true, button: 0, clientX: 42, clientY: 10
    }));
    await flush();
    assert.ok(document.querySelector(".ticketPop"), "popup opened via hit-tested td despite tbody target");
    const esc = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    document.dispatchEvent(esc);
    await flush();
    assert.equal(document.querySelector(".ticketPop"), null, "Escape closed popup");
  } finally {
    document.elementFromPoint = originalEqp;
  }
});

test("summary SLA tab renders counts and persists summarySla", { timeout: 8000 }, async () => {
  const tabSummary = document.getElementById("tabSummary");
  const tabTickets = document.getElementById("tabTickets");
  const stored = peek("lastData");
  assert.ok(stored.summarySla, "summarySla persisted to lastData on load");
  assert.equal(stored.summarySla.items.length, 17, "17 summary items persisted");
  const liveTotals = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const r of grid.currentRows()) {
    if (/^INC/.test(r.number)) liveTotals[parseInt(r.priority)]++;
  }
  assert.deepEqual(stored.summarySla.incidentTotals, liveTotals, "incident totals by severity");

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
  assert.equal(totalFor("Within 10 working days"), "1", "P4 resolve total counts the filtered ticket");
  assert.equal(totalFor("Within 1 hour"), "0", "P1 resolve total empty");
  assert.equal(totalFor("Within 3 business hours"), "1", "P4 respond total counts the filtered ticket");
  assert.match(document.getElementById("sumMeta").textContent,
    /P1 0, P2 0, P3 0, P4 1/);
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
  const toolbar = await import("../surfaces/viewer/toolbar.js");
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
  const toolbar = await import("../surfaces/viewer/toolbar.js");
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
  const toolbar = await import("../surfaces/viewer/toolbar.js");
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

  const toolbar = await import("../surfaces/viewer/toolbar.js");
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
  const toolbar = await import("../surfaces/viewer/toolbar.js");
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
  const toolbar = await import("../surfaces/viewer/toolbar.js");
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

let selModule = null;
async function selectRect(keys, sysIds) {
  if (!selModule) selModule = await import("../surfaces/viewer/selection.js");
  await selModule.setSelPoint(sysIds[0], keys[0], false);
  await selModule.setSelPoint(sysIds[sysIds.length - 1], keys[keys.length - 1], true);
}

test("paste fills a selected 1x2 range with a 1x1 value and persists", { timeout: 8000 }, async () => {
  if (!selModule) selModule = await import("../surfaces/viewer/selection.js");
  await selectRect(["shortDescription"], ["aaa", "bbb"]);
  selModule.pasteIntoSelection([["hello"]]);
  await flush();
  assert.equal(grid.findRowBySysId("aaa").shortDescription, "hello", "first row filled");
  assert.equal(grid.findRowBySysId("bbb").shortDescription, "hello", "second row filled");
  const cellA = document.querySelector("#tbl tbody tr[data-sys-id='aaa']").children[1].textContent;
  assert.equal(cellA, "hello", "grid re-rendered with pasted value");
});

test("Ctrl+V pastes from the clipboard into the selected range", { timeout: 8000 }, async () => {
  if (!selModule) selModule = await import("../surfaces/viewer/selection.js");
  await selectRect(["shortDescription"], ["aaa", "bbb"]);
  setClipboardText("clip-paste");
  document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "v", ctrlKey: true, bubbles: true }));
  await flush();
  assert.equal(grid.findRowBySysId("aaa").shortDescription, "clip-paste", "clipboard value applied");
  assert.equal(grid.findRowBySysId("bbb").shortDescription, "clip-paste", "both rows applied");
  clearClipboardText();
});

test("copy a block then paste tiles it vertically into a larger selection", { timeout: 8000 }, async () => {
  if (!selModule) selModule = await import("../surfaces/viewer/selection.js");
  grid.findRowBySysId("aaa").shortDescription = "srcA";
  grid.findRowBySysId("bbb").shortDescription = "srcB";
  grid.render();
  await selectRect(["shortDescription", "assignedTo"], ["aaa"]);
  selModule.copySelectedRange();
  assert.ok(selModule.getLastCopy(), "copy recorded an internal block");
  await selectRect(["shortDescription", "assignedTo"], ["aaa", "bbb"]);
  selModule.pasteIntoSelection(selModule.getLastCopy().values);
  await flush();
  assert.equal(grid.findRowBySysId("aaa").shortDescription, "srcA");
  assert.equal(grid.findRowBySysId("bbb").shortDescription, "srcA", "one-row source tiled across both target rows");
});

test("picker-column paste stores the canonical option value", { timeout: 8000 }, async () => {
  if (!selModule) selModule = await import("../surfaces/viewer/selection.js");
  await selectRect(["solutionType"], ["aaa", "bbb"]);
  selModule.pasteIntoSelection([["workaround solution"]]);
  await flush();
  assert.equal(grid.findRowBySysId("aaa").solutionType, "Workaround solution", "canonical option stored");
  assert.equal(grid.findRowBySysId("bbb").solutionType, "Workaround solution");
});

test("paste skips non-editable number column and reports the skip", { timeout: 8000 }, async () => {
  if (!selModule) selModule = await import("../surfaces/viewer/selection.js");
  const before = grid.findRowBySysId("aaa").number;
  await selectRect(["number", "shortDescription"], ["aaa"]);
  const res = selModule.pasteIntoSelection([["X", "Y"]]);
  await flush();
  assert.equal(res.skipped, 1, "number column counted as skipped");
  assert.equal(res.touched, 1, "shortDescription column filled");
  assert.equal(grid.findRowBySysId("aaa").number, before, "number column unchanged");
  assert.equal(grid.findRowBySysId("aaa").shortDescription, "Y", "adjacent editable column filled");
});

test("fill handle becomes visible when a selection exists and hides without one", async () => {
  if (!selModule) selModule = await import("../surfaces/viewer/selection.js");
  await selectRect(["shortDescription"], ["aaa"]);
  await flush();
  const h = document.getElementById("fillHandle");
  assert.ok(h, "fill handle element exists");
  assert.ok(!h.classList.contains("hidden"), "handle visible with a selection");
  await selModule.clearSelection();
  await flush();
  assert.ok(h.classList.contains("hidden"), "handle hidden after clear");
});

test("undo restores the pre-paste value after a paste", { timeout: 8000 }, async () => {
  if (!selModule) selModule = await import("../surfaces/viewer/selection.js");
  grid.findRowBySysId("aaa").shortDescription = "original";
  grid.findRowBySysId("bbb").shortDescription = "orig-b";
  grid.render();
  await selectRect(["shortDescription"], ["aaa", "bbb"]);
  selModule.pasteIntoSelection([["changed"]]);
  await flush();
  assert.equal(grid.findRowBySysId("aaa").shortDescription, "changed", "paste applied");
  assert.equal(grid.findRowBySysId("bbb").shortDescription, "changed", "paste applied both");
  selModule.undoLast();
  await flush();
  assert.equal(grid.findRowBySysId("aaa").shortDescription, "original", "undo restored first row");
  assert.equal(grid.findRowBySysId("bbb").shortDescription, "orig-b", "undo restored second row to its prior value");
});

test("Ctrl+Z undoes the last paste", { timeout: 8000 }, async () => {
  if (!selModule) selModule = await import("../surfaces/viewer/selection.js");
  grid.findRowBySysId("aaa").shortDescription = "z-original";
  grid.render();
  await selectRect(["shortDescription"], ["aaa", "bbb"]);
  selModule.pasteIntoSelection([["z-pasted"]]);
  await flush();
  assert.equal(grid.findRowBySysId("aaa").shortDescription, "z-pasted");
  document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
  await flush();
  assert.equal(grid.findRowBySysId("aaa").shortDescription, "z-original", "Ctrl+Z undid the paste");
});

test("column-copy button removed from headers", async () => {
  const copyBtns = document.querySelectorAll("#tbl thead th .colCopy");
  assert.equal(copyBtns.length, 0, "no .colCopy button remains");
  const resizeHandles = document.querySelectorAll("#tbl thead th .colResize");
  assert.ok(resizeHandles.length > 0, "resize handles exist on headers");
});

test("persisted column width is applied by buildHead", async () => {
  const store = await import("../surfaces/viewer/store.js");
  store.setColWidths({ shortDescription: 300 });
  grid.buildHead();
  const ths = document.querySelectorAll("#tbl thead th");
  const idx = [...ths].findIndex(t => t.textContent.trim() === "Short description");
  const col = document.querySelectorAll("#tbl colgroup col")[idx];
  assert.equal(col.style.width, "300px", "col width reflects persisted value");
});

test("dragging a column resize handle updates and persists the width", { timeout: 8000 }, async () => {
  const store = await import("../surfaces/viewer/store.js");
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
  const store = await import("../surfaces/viewer/store.js");
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

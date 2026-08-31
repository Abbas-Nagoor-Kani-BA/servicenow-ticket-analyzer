import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const win = new Window({ url: "https://viewer.local/" });
globalThis.window = win;
globalThis.document = win.document;
globalThis.HTMLElement = win.HTMLElement;
globalThis.HTMLInputElement = win.HTMLInputElement;
globalThis.MouseEvent = win.MouseEvent;
globalThis.Node = win.Node;

const { DataGrid } = await import("../components/data-grid.ts");
import type { GridColumn, DataGridState } from "../components/data-grid.ts";

/*
 * Component-level tests for the grid.
 *
 * The viewer DOM test drives the grid through 30-grid and passes 31/31, but it
 * cannot see the component's own contract: it missed a search-picker bug for
 * exactly that reason. These exercise DataGrid directly.
 */

const COLS: GridColumn[] = [
  ["number", "Number", "num", 120],
  ["shortDescription", "Short description", "", 150],
  ["assignTimeUtcIso", "Assign time", "inst", 155],
  ["state", "State", "", 105]
];

function setup(overrides: Partial<DataGridState> = {}, options: Record<string, unknown> = {}) {
  win.document.body.innerHTML = `
    <span id="count"></span>
    <div id="slaBar" class="hidden"></div>
    <div id="wrap"><table id="tbl"><thead></thead><tbody></tbody></table></div>
  `;
  const $ = (id: string) => win.document.getElementById(id) as HTMLElement;

  let rendered = 0;
  const sorted: string[] = [];
  const widthChanges: Record<string, number>[] = [];

  const grid = new DataGrid(
    $("wrap"),
    {},
    {
      table: $("tbl") as HTMLTableElement,
      count: $("count"),
      slaBar: $("slaBar"),
      // Identity by default: the grid passes this into buildReport, which
      // uses it to normalise dates, so a transforming formatter would change
      // the derived SLA results rather than just the displayed text.
      fmtInstant: (v, _row) => v || "",
      columnOptions: (_key, _row) => null,
      onSort: (key) => sorted.push(key),
      onWidthsChange: (w) => widthChanges.push(w),
      afterRender: () => rendered++,
      ...(options as object)
    }
  );

  const state: DataGridState = {
    cols: COLS,
    rows: [],
    total: 0,
    sortKey: null,
    sortDir: 1,
    colWidths: {},
    ...overrides
  };

  return { grid, state, sorted, widthChanges, rendered: () => rendered, $ };
}

test("header renders one th per column with its label", () => {
  const { grid, state } = setup({ rows: [], total: 0 });
  grid.render(state);

  const labels = [...win.document.querySelectorAll("#tbl thead th")].map((th) => th.textContent);
  assert.deepEqual(labels, ["Number", "Short description", "Assign time", "State"]);
  assert.equal(win.document.querySelectorAll("#tbl thead th .colResize").length, 4);
});

test("columns get their default width, or the persisted one", () => {
  const { grid, state } = setup({ colWidths: { shortDescription: 321 } });
  grid.render(state);

  const widths = [...win.document.querySelectorAll("#tbl colgroup col")].map((c) => (c as HTMLElement).style.width);
  assert.deepEqual(widths, ["120px", "321px", "155px", "105px"]);
});

test("refreshHead applies new widths without re-rendering rows", () => {
  const { grid, state, rendered } = setup({ rows: [{ sysId: "a", number: "INC1", state: "Closed" }], total: 1 });
  grid.render(state);
  assert.equal(rendered(), 1);

  grid.refreshHead({ number: 400 });
  assert.equal(
    (win.document.querySelectorAll("#tbl colgroup col")[0] as HTMLElement).style.width,
    "400px",
    "head reflects the override"
  );
  assert.equal(rendered(), 1, "rows were not rebuilt");
});

test("sorting marks the sorted column and reports the click", () => {
  const { grid, state, sorted } = setup({ sortKey: "state", sortDir: -1 });
  grid.render(state);

  const th = [...win.document.querySelectorAll("#tbl thead th")].find(
    (n) => n.textContent === "State"
  ) as HTMLElement;
  assert.ok(th.classList.contains("sorted"));
  assert.ok(th.classList.contains("desc"), "descending is marked");

  th.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  assert.deepEqual(sorted, ["state"]);
});

test("rows render one td per column with the row values", () => {
  const { grid, state } = setup({
    rows: [{ sysId: "a", number: "INC0001", shortDescription: "Printer jammed", state: "Closed" }],
    total: 1
  });
  grid.render(state);

  const tr = win.document.querySelector("#tbl tbody tr") as HTMLElement;
  assert.equal(tr.dataset.sysId, "a");
  const cells = [...tr.children].map((c) => c.textContent);
  assert.deepEqual(cells, ["INC0001", "Printer jammed", "", "Closed"]);
});

test("instant columns are formatted through the injected formatter", () => {
  const { grid, state } = setup(
    { rows: [{ sysId: "a", number: "INC1", assignTimeUtcIso: "2026-01-01T10:00:00Z", state: "Closed" }] },
    { fmtInstant: (v: string) => (v ? `fmt:${v}` : "") }
  );
  grid.render(state);

  const td = win.document.querySelectorAll("#tbl tbody tr td")[2] as HTMLElement;
  assert.equal(td.textContent, "fmt:2026-01-01T10:00:00Z");
  assert.ok(td.classList.contains("inst"));
});

test("an empty instant cell is marked so the UI can dim it", () => {
  const { grid, state } = setup({ rows: [{ sysId: "a", number: "INC1", state: "Closed" }] });
  grid.render(state);

  const td = win.document.querySelectorAll("#tbl tbody tr td")[2] as HTMLElement;
  assert.ok(td.classList.contains("empty-time"));
});

test("a value outside the column option list is flagged", () => {
  const { grid, state } = setup(
    { rows: [{ sysId: "a", number: "INC1", shortDescription: "Bananas", state: "Closed" }] },
    { columnOptions: () => ["Permanent fix", "Workaround"] }
  );
  grid.render(state);

  const td = win.document.querySelectorAll("#tbl tbody tr td")[1] as HTMLElement;
  assert.ok(td.classList.contains("offlist"));
  assert.ok(td.classList.contains("editable"));
});

test("a value inside the option list is not flagged", () => {
  const { grid, state } = setup(
    { rows: [{ sysId: "a", number: "INC1", shortDescription: "Workaround", state: "Closed" }] },
    { columnOptions: () => ["Permanent fix", "Workaround"] }
  );
  grid.render(state);

  const td = win.document.querySelectorAll("#tbl tbody tr td")[1] as HTMLElement;
  assert.equal(td.classList.contains("offlist"), false);
});

test("footer shows the filtered and total counts and the type breakdown", () => {
  const { grid, state, $ } = setup({
    rows: [
      { sysId: "a", number: "INC0001", state: "Closed" },
      { sysId: "b", number: "REQ0001", state: "Closed" }
    ],
    total: 7
  });
  grid.render(state);

  assert.equal($("count").textContent, "2 / 7 tickets");
  assert.equal($("slaBar").classList.contains("hidden"), false, "legend is shown when there is a breakdown");
  assert.match($("slaBar").textContent, /Incident/);
});

test("footer legend hides when there are no rows", () => {
  const { grid, state, $ } = setup({ rows: [], total: 0 });
  grid.render(state);

  assert.equal($("count").textContent, "0 / 0 tickets");
  assert.ok($("slaBar").classList.contains("hidden"));
});

test("a closed INC with breached SLAs is marked", () => {
  // Shape taken from tools/report-test.js, where this row yields slaBreach "RM":
  // response 1h exceeds the P2 15m target, and 14h exceeds the P2 8h max.
  const breached = {
    sysId: "a",
    number: "INC0001",
    priority: "2 - High",
    state: "Resolved",
    assignmentGroup: "QA Queue Alpha",
    configItem: "App A",
    createdOn: "2026-08-10 09:00:00",
    assignTimeUtcIso: "2026-08-10T01:00:00.000Z",
    acknTimeUtcIso: "2026-08-10T02:00:00.000Z",
    resolvedAt: "2026-08-10 15:00:00"
  };
  const { grid, state } = setup({ rows: [breached], total: 1 });
  grid.render(state);

  const td = win.document.querySelectorAll("#tbl tbody tr td")[0] as HTMLElement;
  const classes = [...td.classList].filter((c) => c.startsWith("sla-breach"));
  assert.ok(classes.length > 0, `expected a breach marker, got: ${td.className}`);
  assert.match(td.getAttribute("data-tip") ?? "", /SLA breached/);
});

test("a low-confidence parse is flagged on solutionType and rootCause", () => {
  const { grid, state } = setup({
    cols: [["solutionType", "Solution type", "", 115], ["rootCause", "Root cause", "", 130]],
    rows: [{ sysId: "a", number: "INC1", solutionType: "Reboot", rootCause: "Hardware", parseReview: true }]
  });
  grid.render(state);

  const tds = [...win.document.querySelectorAll("#tbl tbody tr td")] as HTMLElement[];
  assert.ok(tds[0].classList.contains("review"));
  assert.ok(tds[1].classList.contains("review"));
});

test("an open cell editor blocks the re-render", () => {
  const { grid, state, rendered } = setup({ rows: [{ sysId: "a", number: "INC1", state: "Closed" }], total: 1 });
  grid.render(state);
  assert.equal(rendered(), 1);

  const td = win.document.querySelectorAll("#tbl tbody tr td")[1] as HTMLElement;
  td.classList.add("edit-input");

  grid.render({ ...state, rows: [], total: 0 });
  assert.equal(rendered(), 1, "render was skipped so the editor is not torn down");
  assert.equal(win.document.querySelectorAll("#tbl tbody tr").length, 1, "rows untouched");
});

test("afterRender runs exactly once per render", () => {
  const { grid, state, rendered } = setup({ rows: [{ sysId: "a", number: "INC1" }] });
  grid.render(state);
  grid.render({ ...state, rows: [] });
  assert.equal(rendered(), 2);
});

test("updateRows re-renders only the changed rows in place", () => {
  const { grid, state, rendered } = setup({
    rows: [
      { sysId: "a", number: "INC0001", shortDescription: "Before", state: "Closed" },
      { sysId: "b", number: "INC0002", shortDescription: "Keep me", state: "Closed" }
    ],
    total: 2
  });
  grid.render(state);

  const rowsBefore = win.document.querySelectorAll("#tbl tbody tr");
  assert.equal(rowsBefore.length, 2);

  // Mutate row "a" in place, then updateRows must reflect it without touching "b".
  state.rows[0].shortDescription = "After";
  grid.updateRows(["a"]);

  const trA = win.document.querySelector('#tbl tbody tr[data-sys-id="a"]') as HTMLElement;
  const trB = win.document.querySelector('#tbl tbody tr[data-sys-id="b"]') as HTMLElement;
  assert.equal(trA.children[1].textContent, "After");
  assert.equal(trB.children[1].textContent, "Keep me");
  assert.equal(win.document.querySelectorAll("#tbl tbody tr").length, 2);
  assert.equal(rendered(), 2);
});

test("updateRows is a no-op with an empty change set", () => {
  const { grid, state, rendered } = setup({ rows: [{ sysId: "a", number: "INC1" }], total: 1 });
  grid.render(state);
  grid.updateRows([]);
  assert.equal(rendered(), 1);
});

test("updateRows is blocked while a cell editor is open", () => {
  const { grid, state, rendered } = setup({ rows: [{ sysId: "a", number: "INC1", state: "Closed" }], total: 1 });
  grid.render(state);

  const td = win.document.querySelector("#tbl tbody tr td") as HTMLElement;
  td.classList.add("edit-input");
  td.innerHTML = "<input>";

  state.rows[0].state = "Changed";
  grid.updateRows(["a"]);
  assert.equal(rendered(), 1);
});

test("updateRows keeps the legend when the changed subset has no breaches", () => {
  // Two rows: one breached (legend would show), one not. Updating only the
  // non-breached row must NOT hide the legend — counts come from ALL rows.
  const breached = {
    sysId: "b",
    number: "INC0001",
    priority: "2 - High",
    state: "Resolved",
    createdOn: "2026-08-10 09:00:00",
    assignTimeUtcIso: "2026-08-10T01:00:00.000Z",
    acknTimeUtcIso: "2026-08-10T02:00:00.000Z",
    resolvedAt: "2026-08-10 15:00:00"
  };
  const { grid, state, $ } = setup({
    rows: [breached, { sysId: "c", number: "INC0002", state: "Open" }],
    total: 2
  });
  grid.render(state);
  assert.equal($("slaBar").classList.contains("hidden"), false, "legend visible after render");

  state.rows[1].solutionType = "Permanent solution";
  grid.updateRows(["c"]);
  assert.equal($("slaBar").classList.contains("hidden"), false, "legend still visible after updating a non-breach row");
});

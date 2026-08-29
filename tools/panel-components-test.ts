import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

/*
 * DOM-level tests for the OOP components.
 *
 * The point is the contract in components/component.ts: build once, patch
 * always. If a component ever rebuilds its subtree on a value edit, the caret
 * and focus are lost — which is invisible to a unit test and obvious to a user.
 * These tests assert focus survives typing.
 */

// Strip scripts and stylesheet links: happy-dom resolves them over the network.
const html = readFileSync(new URL("../panel/panel.html", import.meta.url), "utf8")
  .replace(/<script[\s\S]*?<\/script>/gi, "")
  .replace(/<link[^>]*>/gi, "");

const win = new Window({ url: "https://panel.local/" });
globalThis.window = win;
globalThis.document = win.document;
globalThis.HTMLElement = win.HTMLElement;
globalThis.HTMLInputElement = win.HTMLInputElement;
globalThis.Event = win.Event;
globalThis.MouseEvent = win.MouseEvent;
globalThis.KeyboardEvent = win.KeyboardEvent;
globalThis.localStorage = win.localStorage;
win.document.body.innerHTML = html;

const { LogCard } = await import("../components/log-card.ts");
const { ProgressCard } = await import("../components/progress-card.ts");
const { ConditionBuilder, validateConditions, COND_OPS } = await import("../components/condition-builder.ts");

const FIELDS = [
  { key: "assignedTo", label: "Assigned to", field: "assigned_to", type: "ref" },
  { key: "state", label: "State", field: "state", type: "choice", choicesKey: "states" },
  { key: "number", label: "Number", field: "number", type: "string" },
  { key: "createdOn", label: "Created", field: "sys_created_on", type: "date" },
  { key: "parentIncident", label: "Parent incident", field: "u_parent_incident1", type: "ref", tables: ["incident"] }
];

const $ = (id) => {
  const node = win.document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
};

function makeBuilder(table = "incident") {
  const root = $("condRows");
  root.innerHTML = "";
  const builder = new ConditionBuilder(
    root,
    { on: { change: () => changed.push("change") } },
    {
      fields: FIELDS,
      choiceList: (key) => (key === "states" ? [{ value: 2, label: "In Progress" }, { value: 7, label: "Closed" }] : []),
      tableLabel: (t) => ({ incident: "Incident", problem: "Problem" })[t] || t,
      addButton: $("addCondBtn")
    }
  );
  builder.setTable(table);
  return builder;
}

let changed = [];

test("log card appends entries and counts errors", () => {
  const card = new LogCard($("logCard"), { modal: $("logModal") });

  assert.equal($("logCard").classList.contains("hidden"), true, "hidden until first entry");

  card.log("first");
  card.log("boom", "error");
  card.log("yay", "success");

  assert.equal($("logCard").classList.contains("hidden"), false);
  assert.equal($("log").childElementCount, 3);
  assert.equal($("logErrBadge").textContent, "1");
  assert.equal($("logErrBadge").classList.contains("hidden"), false);
  assert.match($("log").children[1].textContent, /boom/);
});

test("log card popup mirrors the same entries", () => {
  const card = new LogCard($("logCard"), { modal: $("logModal") });
  card.log("alpha");
  card.log("beta");

  assert.equal($("logModal").classList.contains("hidden"), true);
  card.open();
  assert.equal($("logModal").classList.contains("hidden"), false);
  assert.equal($("logMirror").childElementCount, 2, "rebuilt from state, not copied nodes");

  card.log("gamma");
  assert.equal($("logMirror").childElementCount, 3, "stays in sync while open");

  card.close();
  assert.equal($("logModal").classList.contains("hidden"), true);
});

test("progress card derives the bar from stage and counts", () => {
  const card = new ProgressCard($("progressWrap"));
  assert.equal($("progressWrap").classList.contains("hidden"), true);

  card.begin();
  assert.equal($("progressWrap").classList.contains("hidden"), false);
  assert.equal($("fill").style.width, "4%");

  assert.equal(card.apply({ stage: "resolve", detail: "resolving" }), "info");
  assert.equal($("fill").style.width, "8%");
  assert.equal($("stageLabel").textContent, "resolving");

  card.apply({ stage: "phase1", detail: "50/100", pulled: 50, planned: 100 });
  assert.equal($("fill").style.width, "40%", "20 base + 50% of the 40 point span");
  assert.equal($("pullCounter").classList.contains("hidden"), false);
  assert.match($("pullCounter").textContent, /50 of 100 pulled/);

  assert.equal(card.apply({ stage: "done", detail: "all done" }), "success");
  assert.equal($("fill").style.width, "100%");
  assert.equal($("pullCounter").classList.contains("hidden"), true);

  card.end();
  assert.equal($("progressWrap").classList.contains("hidden"), true);
});

test("progress card marks failures and leaves the bar alone for diagnostics", () => {
  const card = new ProgressCard($("progressWrap"));
  card.begin();
  card.apply({ stage: "phase2", detail: "1/2" });

  assert.equal(card.apply({ stage: "diag", detail: "200 OK" }), "info");
  assert.notEqual($("fill").style.width, "100%", "diagnostics must not move the bar");

  assert.equal(card.apply({ stage: "diag", detail: "401 unauthorized" }), "error");
  assert.equal(card.apply({ stage: "error", detail: "it broke" }), "error");
  assert.equal($("fill").style.width, "100%");
  assert.equal($("stageLabel").textContent, "it broke");
});

test("condition builder renders a row and emits change", () => {
  changed = [];
  const builder = makeBuilder();
  assert.match($("condRows").textContent, /No conditions/);

  builder.addRow();

  assert.equal($("condRows").querySelectorAll(".crow").length, 1);
  assert.equal(changed.length, 1, "adding a row notifies so the query preview refreshes");
  assert.equal($("condRows").querySelector(".cfield").value, "assignedTo");
});

test("typing a value keeps focus and caret because rows are not rebuilt", () => {
  const builder = makeBuilder();
  builder.addRow();

  const fieldSelect = $("condRows").querySelector(".cfield");
  fieldSelect.value = "number";
  fieldSelect.dispatchEvent(new win.Event("change"));

  const input = $("condRows").querySelector(".cval");
  assert.equal(input.type, "text");

  input.focus();
  input.value = "INC0";
  input.dispatchEvent(new win.Event("input"));
  input.value = "INC001";
  input.dispatchEvent(new win.Event("input"));

  assert.equal(win.document.activeElement, input, "focus survived two keystrokes");
  assert.equal(input.value, "INC001", "no rebuild overwrote the value");
  assert.deepEqual(builder.conditions(), [
    { join: "AND", field: "number", oper: "contains", value: "INC001", value2: "" }
  ]);
});

test("changing the field resets operator and value, and rebuilds", () => {
  const builder = makeBuilder();
  builder.addRow();

  const fieldSelect = $("condRows").querySelector(".cfield");
  fieldSelect.value = "createdOn";
  fieldSelect.dispatchEvent(new win.Event("change"));

  const ops = [...$("condRows").querySelectorAll(".cop option")].map((o) => o.value);
  assert.deepEqual(ops, COND_OPS.date.map(([v]) => v));
  assert.equal($("condRows").querySelector(".cop").value, "before");

  const opSelect = $("condRows").querySelector(".cop");
  opSelect.value = "between";
  opSelect.dispatchEvent(new win.Event("change"));
  assert.equal($("condRows").querySelectorAll(".cval").length, 2, "between needs two dates");
});

test("the second row gets a join selector wired to state", () => {
  const builder = makeBuilder();
  builder.addRow();
  builder.addRow();

  const rows = $("condRows").querySelectorAll(".crow");
  assert.equal(rows[0].querySelector(".cjoin"), null, "first row has no join");
  assert.ok(rows[1].querySelector(".cjoin"), "second row does");

  rows[1].querySelector(".cjoin").value = "OR";
  rows[1].querySelector(".cjoin").dispatchEvent(new win.Event("change"));

  assert.equal(builder.conditions()[1].join, "OR");
});

test("deleting a row re-renders and normalises joins", () => {
  const builder = makeBuilder();
  builder.addRow();
  builder.addRow();

  $("condRows").querySelectorAll(".cdel")[0].dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

  assert.equal($("condRows").querySelectorAll(".crow").length, 1);
  assert.equal(builder.conditions().length, 1);
});

test("switching table drops fields that do not exist on it", () => {
  const builder = makeBuilder("incident");
  builder.addRow();
  const fieldSelect = $("condRows").querySelector(".cfield");
  fieldSelect.value = "parentIncident";
  fieldSelect.dispatchEvent(new win.Event("change"));
  assert.equal(builder.conditions()[0].field, "u_parent_incident1");

  builder.setTable("problem");

  const options = [...$("condRows").querySelectorAll(".cfield option")].map((o) => o.value);
  assert.equal(options.includes("parentIncident"), false, "incident-only field is gone");
  assert.notEqual(builder.conditions()[0].field, "u_parent_incident1", "row was coerced");
});

test("conditions() reports the offending row in user-facing terms", () => {
  const builder = makeBuilder();
  builder.addRow();

  const fieldSelect = $("condRows").querySelector(".cfield");
  fieldSelect.value = "number";
  fieldSelect.dispatchEvent(new win.Event("change"));

  assert.throws(() => builder.conditions(), /Condition 1: enter a value/);

  const input = $("condRows").querySelector(".cval");
  input.value = "INC001";
  input.dispatchEvent(new win.Event("input"));
  assert.doesNotThrow(() => builder.conditions());
});

test("validateConditions rejects a field absent from the chosen table", () => {
  assert.throws(
    () =>
      validateConditions(
        [{ join: "AND", field: "parentIncident", op: "isEmpty", value: "", value2: "" }],
        { fields: FIELDS, tableLabel: (t) => t },
        "problem"
      ),
    /does not exist on problem/
  );
});

// --- filter set list ---

const { FilterSetList, migrateLegacyFilterSets } = await import("../components/filter-set-list.ts");
const { createMemoryKeyValueStore } = await import("../data/key-value-store.ts");
const { FilterListStore } = await import("../data/repositories/filter-list-repository.ts");

function makeFilterList(repo = new FilterListStore(createMemoryKeyValueStore())) {
  const box = $("filterListBox");
  box.innerHTML = "";
  return new FilterSetList(
    box,
    {},
    {
      repository: repo,
      card: $("filterListCard"),
      addButton: $("addFilterBtn"),
      describe: (s) => `${s.table}:${JSON.stringify(s.conditions)}`,
      keyOf: (s) => JSON.stringify([s.table, s.conditions])
    }
  );
}

test("filter list hides its card until a set exists", async () => {
  const list = makeFilterList();
  assert.equal($("filterListCard").classList.contains("hidden"), true);
  assert.equal($("addFilterBtn").textContent, "+ Add to filter list");

  await list.add({ table: "incident", conditions: [] });

  assert.equal($("filterListCard").classList.contains("hidden"), false);
  assert.equal($("filterListBox").querySelectorAll(".flitem").length, 1);
  assert.equal($("addFilterBtn").textContent, "Add to filter list (1)");
});

test("filter list rejects a duplicate set", async () => {
  const list = makeFilterList();
  assert.equal(await list.add({ table: "incident", conditions: [] }), "added");
  assert.equal(await list.add({ table: "incident", conditions: [] }), "duplicate");
  assert.equal(list.getSets().length, 1);
});

test("filter list persists through the repository, not localStorage", async () => {
  const repo = new FilterListStore(createMemoryKeyValueStore());
  const list = makeFilterList(repo);
  await list.add({ table: "incident", conditions: [{ field: "state" }] });

  assert.equal((await repo.load()).length, 1);

  const reloaded = makeFilterList(repo);
  await reloaded.load();
  assert.equal(reloaded.getSets().length, 1, "survives a reload");
});

test("removing and clearing a filter list persists each change", async () => {
  const repo = new FilterListStore(createMemoryKeyValueStore());
  const list = makeFilterList(repo);
  await list.add({ table: "incident", conditions: [] });
  await list.add({ table: "problem", conditions: [] });

  $("filterListBox").querySelectorAll(".flitem button")[0]
    .dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(list.getSets().length, 1);
  assert.equal((await repo.load()).length, 1);

  await list.clear();
  assert.equal(list.getSets().length, 0);
  assert.deepEqual(await repo.load(), []);
  assert.equal($("filterListCard").classList.contains("hidden"), true);
});

test("legacy localStorage filter sets are imported once", async () => {
  const repo = new FilterListStore(createMemoryKeyValueStore());
  globalThis.localStorage.setItem("snFilterList", JSON.stringify([{ table: "incident", conditions: [] }]));

  assert.equal(await migrateLegacyFilterSets(repo), 1);
  assert.equal((await repo.load()).length, 1);
  assert.equal(globalThis.localStorage.getItem("snFilterList"), null, "legacy key cleared");

  // a second run must not re-import or clobber existing sets
  assert.equal(await migrateLegacyFilterSets(repo), 0);
  assert.equal((await repo.load()).length, 1);
});

test("legacy import is a no-op when the new store already has sets", async () => {
  const repo = new FilterListStore(createMemoryKeyValueStore());
  await repo.save([{ table: "problem", conditions: [] }]);
  globalThis.localStorage.setItem("snFilterList", JSON.stringify([{ table: "incident", conditions: [] }]));

  assert.equal(await migrateLegacyFilterSets(repo), 0);
  assert.equal((await repo.load())[0].table, "problem", "existing sets win");
  assert.equal(globalThis.localStorage.getItem("snFilterList"), null);
});

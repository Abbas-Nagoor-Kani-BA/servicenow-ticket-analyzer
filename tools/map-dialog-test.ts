import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const win = new Window({ url: "https://viewer.local/" });
globalThis.window = win;
globalThis.document = win.document;
globalThis.HTMLElement = win.HTMLElement;
globalThis.HTMLInputElement = win.HTMLInputElement;
globalThis.KeyboardEvent = win.KeyboardEvent;
globalThis.MouseEvent = win.MouseEvent;
globalThis.Node = win.Node;

const { Modal, closeAllModals } = await import("../components/modal.ts");
const { MapDialog } = await import("../components/map-dialog.ts");

/*
 * Export column mapping.
 *
 * tools/viewer-dom-test.js has zero references to the map dialog, so a refactor
 * there was completely unverified by the existing suite. These cover the two
 * invariants the component exists to enforce: one column per field, and no
 * saving while two fields share a column.
 */

const GROUPS = [
  { name: "General", items: [["#row", "Row number", () => "1"]] },
  {
    name: "Ticket fields",
    items: [
      ["number", "Number", () => ""],
      ["shortDescription", "Short description", () => ""]
    ]
  }
];

const DEFAULTS = { "#row": "A", number: "B" };

function mount() {
  closeAllModals();
  win.document.body.innerHTML = `
    <div id="mapModal" class="hidden">
      <input id="mapSearch">
      <div id="mapList"></div>
    </div>
    <div id="letterPop" class="hidden">
      <input id="letterSearch">
      <div id="letterList"></div>
    </div>
  `;
  const $ = (id: string) => win.document.getElementById(id) as HTMLElement;
  const el = <T extends HTMLElement>(id: string) => $(id) as T;

  const letterPop = new Modal($("letterPop"), {}, { backdropClose: false });

  const saved: Record<string, string>[] = [];
  let resets = 0;
  const statuses: { message: string; isError?: boolean }[] = [];

  const dialog = new MapDialog($("mapModal"), {}, {
    search: el<HTMLInputElement>("mapSearch"),
    list: $("mapList"),
    letterPop,
    letterSearch: el<HTMLInputElement>("letterSearch"),
    letterList: $("letterList"),
    groups: GROUPS,
    fieldLabel: (fid) => ({ "#row": "Row number", number: "Number", shortDescription: "Short description" })[fid] ?? "",
    status: (message, isError) => statuses.push({ message, isError }),
    onSave: async (mapping) => saved.push(mapping),
    onReset: async () => {
      resets++;
    }
  });

  const rows = () => [...win.document.querySelectorAll("#mapList .mapRow")] as HTMLElement[];
  const rowFor = (fid: string) =>
    rows().find((r) => r.dataset.fid === fid) as HTMLElement;
  const options = () => [...win.document.querySelectorAll("#letterList .letterOpt")] as HTMLElement[];

  return { $, dialog, letterPop, saved, statuses, resets: () => resets, rows, rowFor, options };
}

test("show renders one row per field with its current column", () => {
  const { dialog, rows, rowFor } = mount();
  dialog.show({ "#row": "A", number: "C" }, DEFAULTS);

  assert.equal(rows().length, 3);
  assert.equal(rowFor("number").querySelector(".mapPick")?.textContent, "C");
  assert.equal(rowFor("shortDescription").querySelector(".mapPick")?.textContent, "— not exported —");
  assert.equal(rowFor("shortDescription").querySelector(".mapPick")?.classList.contains("set"), false);
});

test("show drops unknown fields and out-of-range columns", () => {
  const { dialog } = mount();
  dialog.show({ "#row": "ZZZZ", bogus: "B", number: "B" }, DEFAULTS);

  const mapping = (dialog as any).getState().mapping;
  assert.deepEqual(mapping, { number: "B" }, "unknown fid and out-of-range column rejected");
});

test("show falls back to the defaults when nothing is stored", () => {
  const { dialog, rowFor } = mount();
  dialog.show(null, DEFAULTS);

  assert.equal(rowFor("#row").querySelector(".mapPick")?.textContent, "A");
  assert.equal(rowFor("number").querySelector(".mapPick")?.textContent, "B");
});

test("search filters rows and shows a no-match message", () => {
  const { dialog, $, rows } = mount();
  dialog.show(null, DEFAULTS);

  const search = $("mapSearch") as HTMLInputElement;
  search.value = "short";
  search.dispatchEvent(new win.Event("input"));

  const visible = rows().filter((r) => r.style.display !== "none");
  assert.equal(visible.length, 1);
  assert.equal(visible[0].dataset.fid, "shortDescription");

  search.value = "zzz";
  search.dispatchEvent(new win.Event("input"));
  const none = win.document.querySelector("#mapList .mapNone") as HTMLElement;
  assert.equal(none.style.display, "", "no-match hint shown");
  assert.match(none.textContent, /No fields match "zzz"/);
});

test("clicking a field opens the column picker for it", () => {
  const { dialog, letterPop, rowFor, options } = mount();
  dialog.show(null, DEFAULTS);

  (rowFor("shortDescription").querySelector(".mapPick") as HTMLElement)
    .dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));

  assert.equal(letterPop.isOpen(), true);
  assert.equal(options().length, 41, "— not exported — plus columns A..AN");
  assert.equal(options()[0].textContent, "— not exported —");
});

test("clicking the same field again closes the picker", () => {
  const { dialog, letterPop, rowFor } = mount();
  dialog.show(null, DEFAULTS);
  const pick = rowFor("shortDescription").querySelector(".mapPick") as HTMLElement;

  pick.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(letterPop.isOpen(), true);

  pick.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(letterPop.isOpen(), false, "toggles");
});

test("columns held by another field are marked taken and named", () => {
  const { dialog, rowFor, options } = mount();
  dialog.show({ "#row": "A", number: "B" }, DEFAULTS);

  (rowFor("shortDescription").querySelector(".mapPick") as HTMLElement)
    .dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));

  const a = options().find((o) => o.textContent?.startsWith("A")) as HTMLElement;
  assert.ok(a.classList.contains("taken"), "column A is taken");
  assert.match(a.textContent ?? "", /Row number/);
});

test("the column the field already holds is not marked taken", () => {
  const { dialog, rowFor, options } = mount();
  dialog.show({ number: "B" }, DEFAULTS);

  (rowFor("number").querySelector(".mapPick") as HTMLElement)
    .dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));

  const b = options().find((o) => o.textContent === "B") as HTMLElement;
  assert.equal(b.classList.contains("taken"), false, "its own column is current, not taken");
});

test("picking a column evicts the field that held it", () => {
  const { dialog, rowFor, options } = mount();
  dialog.show({ "#row": "A", number: "B" }, DEFAULTS);

  (rowFor("shortDescription").querySelector(".mapPick") as HTMLElement)
    .dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));

  const b = options().find((o) => o.textContent?.startsWith("B")) as HTMLElement;
  b.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

  const mapping = (dialog as any).getState().mapping;
  assert.equal(mapping.shortDescription, "B");
  assert.equal(mapping.number, undefined, "the previous holder was evicted");
});

test("picking the clear entry removes the field from the mapping", () => {
  const { dialog, rowFor, options } = mount();
  dialog.show({ number: "B" }, DEFAULTS);

  (rowFor("number").querySelector(".mapPick") as HTMLElement)
    .dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));

  (options()[0] as HTMLElement).dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

  assert.equal((dialog as any).getState().mapping.number, undefined);
  assert.equal(rowFor("number").querySelector(".mapPick")?.textContent, "— not exported —");
});

test("typing in the column picker narrows the columns", () => {
  const { dialog, $, rowFor, options } = mount();
  dialog.show(null, DEFAULTS);

  (rowFor("shortDescription").querySelector(".mapPick") as HTMLElement)
    .dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));

  const search = $("letterSearch") as HTMLInputElement;
  search.value = "ab";
  search.dispatchEvent(new win.Event("input"));

  const letters = options().map((o) => o.textContent);
  assert.deepEqual(letters, ["AB"], "startsWith match on the column letter");
});

test("Enter in the column picker commits the first option", () => {
  const { dialog, $, rowFor } = mount();
  dialog.show(null, DEFAULTS);

  (rowFor("shortDescription").querySelector(".mapPick") as HTMLElement)
    .dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));

  ($("letterSearch") as HTMLInputElement).dispatchEvent(
    new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
  );

  // The clear entry deletes the key rather than storing an empty letter.
  assert.equal((dialog as any).getState().mapping.shortDescription, undefined);
});

test("save persists the mapping and reports the columns used", async () => {
  const { dialog, saved, statuses } = mount();
  dialog.show({ "#row": "A", number: "B" }, DEFAULTS);

  await dialog.save();

  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0], { "#row": "A", number: "B" });
  assert.match(statuses.at(-1)?.message ?? "", /2 field\(s\), columns A, B/);
});

test("an empty mapping is rejected and nothing is saved", async () => {
  const { dialog, saved, statuses } = mount();
  dialog.show(null, DEFAULTS);
  // show() falls back to the defaults when given nothing, so clear explicitly.
  (dialog as any).setState({ mapping: {} });

  await dialog.save();

  assert.equal(saved.length, 0);
  assert.match(statuses[0].message, /Map at least one field/);
  assert.equal(statuses[0].isError, true);
});

test("two fields sharing a column is rejected", async () => {
  const { dialog, saved, statuses } = mount();
  dialog.show(null, DEFAULTS);
  // Force the invariant the UI prevents, to prove save still guards it.
  (dialog as any).setState({ mapping: { "#row": "A", number: "A" } });

  await dialog.save();

  assert.equal(saved.length, 0);
  assert.match(statuses[0].message, /Two fields point at column A/);
  assert.equal(statuses[0].isError, true);
});

test("a rejected save leaves the dialog usable", async () => {
  const { dialog, saved, statuses } = mount();
  dialog.show(null, DEFAULTS);
  (dialog as any).setState({ mapping: { "#row": "A", number: "A" } });
  await dialog.save();

  (dialog as any).setState({ mapping: { "#row": "A", number: "B" } });
  await dialog.save();

  assert.equal(saved.length, 1, "saves once the conflict is fixed");
  assert.equal(statuses.at(-1)?.isError, undefined);
});

test("reset clears the stored mapping and restores the defaults", async () => {
  const { dialog, resets, statuses, rowFor } = mount();
  dialog.show({ number: "Z" }, DEFAULTS);

  await dialog.reset(DEFAULTS);

  assert.equal(resets(), 1);
  assert.equal(rowFor("#row").querySelector(".mapPick")?.textContent, "A");
  assert.equal(rowFor("number").querySelector(".mapPick")?.textContent, "B");
  assert.match(statuses.length === 0 ? "" : statuses.at(-1)?.message ?? "", /^$|^Mapping reset/);
});

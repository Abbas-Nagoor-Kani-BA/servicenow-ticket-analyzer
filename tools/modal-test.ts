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

const { Modal, hasOpenModal, closeAllModals } = await import("../components/modal.ts");
const { CiDialog } = await import("../components/ci-dialog.ts");

/*
 * Modal stack and Escape cascade.
 *
 * These exist because a refactor replaced the viewer's hand-written Escape
 * if-chain (letterPop -> ciModal -> mapModal -> configModal -> clearSelection)
 * with a stack, and every viewer DOM test passed while Escape on two of those
 * four overlays was silently broken. An if-chain can omit a branch and nothing
 * notices; a stack only works if each overlay actually joins it.
 */

function mount(ids: string[], rootId = "outer") {
  // Rewriting innerHTML orphans any still-registered modal, which would make
  // these tests order-dependent.
  closeAllModals();
  const inner = ids.map((id) => `<div id="${id}" class="hidden"><span id="${id}-inner"></span></div>`).join("");
  win.document.body.innerHTML = `<div id="${rootId}" class="hidden">${inner}</div>`;
  const $ = (id: string) => win.document.getElementById(id) as HTMLElement;
  return { $ };
}

const escape = () =>
  win.document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

test("open and close toggle the hidden class", () => {
  const { $ } = mount([]);
  const modal = new Modal($("outer"), {}, {});

  assert.ok($("outer").classList.contains("hidden"), "starts hidden");
  modal.open();
  assert.equal($("outer").classList.contains("hidden"), false);
  assert.equal(modal.isOpen(), true);

  modal.close();
  assert.ok($("outer").classList.contains("hidden"));
  assert.equal(modal.isOpen(), false);
});

test("clicking the backdrop closes, clicking inside does not", () => {
  const { $ } = mount([]);
  const modal = new Modal($("outer"), {}, {});
  modal.open();

  $("outer").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  assert.equal(modal.isOpen(), false, "backdrop click closes");

  modal.open();
  const inner = win.document.createElement("div");
  $("outer").appendChild(inner);
  inner.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  assert.equal(modal.isOpen(), true, "a click inside is not a backdrop click");
});

test("backdropClose false keeps the overlay open", () => {
  const { $ } = mount([]);
  const modal = new Modal($("outer"), {}, { backdropClose: false });
  modal.open();

  $("outer").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  assert.equal(modal.isOpen(), true);
});

test("onClosed runs for every close route", () => {
  const { $ } = mount([]);
  let closed = 0;
  const modal = new Modal($("outer"), {}, { onClosed: () => closed++ });

  modal.open();
  escape();
  assert.equal(closed, 1, "Escape");
  assert.equal(modal.isOpen(), false);

  modal.open();
  $("outer").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  assert.equal(closed, 2, "backdrop");

  modal.open();
  modal.close();
  assert.equal(closed, 3, "explicit close");

  modal.close();
  assert.equal(closed, 3, "closing twice does not re-fire");
});

test("Escape closes the innermost open modal only", () => {
  const { $ } = mount(["ciModal", "mapModal"]);
  const map = new Modal($("mapModal"), {}, {});
  const ci = new Modal($("ciModal"), {}, {});

  map.open();
  ci.open();

  escape();
  assert.equal(ci.isOpen(), false, "the modal opened last closes first");
  assert.equal(map.isOpen(), true, "the one beneath stays open");

  escape();
  assert.equal(map.isOpen(), false);
});

test("every overlay the viewer can open is on the stack", () => {
  // Regression guard: mapModal and configModal were opened by direct class
  // manipulation and never joined the stack, so Escape did nothing while all 31
  // viewer DOM tests stayed green.
  const { $ } = mount(["mapModal", "ciModal", "configModal", "letterPop"]);
  for (const id of ["mapModal", "ciModal", "configModal", "letterPop"]) {
    const modal = new Modal($(id), {}, {});
    modal.open();
    assert.equal(modal.isOpen(), true, `${id} opens`);
    escape();
    assert.equal(modal.isOpen(), false, `${id} closes on Escape`);
  }
  assert.equal(hasOpenModal(), false);
});

test("hasOpenModal tracks the stack", () => {
  const { $ } = mount(["inner"]);
  const a = new Modal($("outer"), {}, {});
  const b = new Modal($("inner"), {}, {});

  assert.equal(hasOpenModal(), false);
  a.open();
  assert.equal(hasOpenModal(), true);
  b.open();
  escape();
  assert.equal(hasOpenModal(), true, "outer is still open");
  a.close();
  assert.equal(hasOpenModal(), false);
});

test("escapeGuard swallows Escape for the guarded modal and everything below", () => {
  const { $ } = mount(["inner"]);
  const outer = new Modal($("outer"), {}, {});
  const inner = new Modal($("inner"), {}, { escapeGuard: () => true });

  outer.open();
  inner.open();

  escape();
  assert.equal(inner.isOpen(), true, "guard holds");
  assert.equal(outer.isOpen(), true, "and the one beneath is not reached either");
});

test("closing a modal removes it from the stack so it cannot block later ones", () => {
  const { $ } = mount(["inner"]);
  const outer = new Modal($("outer"), {}, {});
  const inner = new Modal($("inner"), {}, {});

  outer.open();
  inner.open();
  inner.close();

  escape();
  assert.equal(outer.isOpen(), false, "Escape reaches the outer modal after the inner closed");
});

// --- CiDialog ---

function mountCi() {
  closeAllModals();
  win.document.body.innerHTML = `<div id="ciModal" class="hidden">
    <input type="checkbox" id="ciEnabled">
    <div id="groupBoard"></div>
    <button id="addGroupBtn"></button>
    <button id="ciDisable"></button><button id="ciCancel"></button>
    <button id="ciClose"></button><button id="ciSave"></button>
  </div>`;
  const $ = (id: string) => win.document.getElementById(id) as HTMLElement;

  const saved: any[] = [];
  let disabled = 0;
  const statuses: { message: string; isError?: boolean }[] = [];

  const dialog = new CiDialog($("ciModal"), {}, {
    onSave: (v) => saved.push(v),
    onDisable: () => {
      disabled++;
    },
    onClosed: () => {},
    status: (message, isError) => statuses.push({ message, isError })
  });

  return { $, dialog, saved, statuses, disabled: () => disabled };
}

test("show seeds a draft without mutating the stored value", () => {
  const { dialog, saved } = mountCi();
  const stored = { enabled: true, groups: [{ name: "A", items: ["ci-1"] }] };

  dialog.show(stored);
  (dialog as any).commit();

  assert.equal(saved.length, 1);
  assert.notEqual(saved[0].groups, stored.groups, "a copy was committed");
  assert.deepEqual(saved[0].groups, [{ name: "A", items: ["ci-1"] }]);
});

function dragChip($: (id: string) => HTMLElement, gi: number, ii: number): void {
  const card = $("groupBoard").querySelectorAll(".ciGroupCard")[gi];
  const chip = card?.querySelectorAll(".ciChip")[ii] as HTMLElement | undefined;
  chip?.dispatchEvent(new win.Event("dragstart", { bubbles: true }));
}

test("add group creates a card with the next free letter name", () => {
  const { $, dialog } = mountCi();
  dialog.show({ enabled: true, groups: [] });

  $("addGroupBtn").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  assert.equal($("groupBoard").querySelectorAll(".ciGroupCard").length, 1);

  const name = ($("groupBoard").querySelector(".ciGroupName") as HTMLInputElement).value;
  assert.equal(name, "Group A");
});

test("group names are de-duplicated on save", () => {
  const { dialog, saved } = mountCi();
  dialog.show({ enabled: true, groups: [{ name: "Same", items: ["a"] }, { name: "same", items: ["b"] }] });

  (dialog as any).commit();

  assert.deepEqual(saved[0].groups.map((g: any) => g.name), ["Same", "same 2"]);
});

test("a group with a name but no items is kept; an unnamed empty one is dropped", () => {
  // The filter is (items.length || name): a named group survives even when
  // empty, so the user does not lose a group they are still building.
  const { dialog, saved } = mountCi();
  dialog.show({
    enabled: true,
    groups: [{ name: "Has items", items: ["a"] }, { name: "Empty", items: [] }, { name: "", items: [] }]
  });

  (dialog as any).commit();
  assert.deepEqual(saved[0].groups, [
    { name: "Has items", items: ["a"] },
    { name: "Empty", items: [] }
  ]);
});

test("saving with no groups is rejected with a message and does not save", () => {
  const { dialog, saved, statuses } = mountCi();
  dialog.show({ enabled: true, groups: [] });

  (dialog as any).commit();
  assert.equal(saved.length, 0);
  assert.match(statuses[0].message, /Add at least one group/);
  assert.equal(statuses[0].isError, true);
});

test("saving enabled groups with no items is rejected", () => {
  const { dialog, saved, statuses } = mountCi();
  dialog.show({ enabled: true, groups: [{ name: "A", items: [] }] });

  (dialog as any).commit();
  assert.equal(saved.length, 0);
  assert.match(statuses[0].message, /Add at least one configuration item/);
});

test("addUnique rejects blanks and case-insensitive duplicates", () => {
  const { dialog } = mountCi();
  dialog.show({ enabled: true, groups: [{ name: "A", items: ["Existing"] }] });

  assert.equal((dialog as any).addUnique(0, "   "), false, "blank");
  assert.equal((dialog as any).addUnique(0, "existing"), false, "duplicate ignoring case");
  assert.equal((dialog as any).addUnique(0, "New"), true);
  assert.equal((dialog as any).addUnique(9, "New"), false, "unknown group");
});

test("pasting a delimited list adds every term", () => {
  const { dialog } = mountCi();
  dialog.show({ enabled: true, groups: [{ name: "A", items: [] }] });

  (dialog as any).addMany(0, "one, two; three\nfour");
  assert.deepEqual((dialog as any).getState().groups[0].items, ["one", "two", "three", "four"]);
});

test("dragging an item between groups moves it", () => {
  const { $, dialog } = mountCi();
  dialog.show({
    enabled: true,
    groups: [{ name: "A", items: ["shared"] }, { name: "B", items: [] }]
  });

  dragChip($, 0, 0);
  (dialog as any).dropItem(1);

  const groups = (dialog as any).getState().groups;
  assert.deepEqual(groups[0].items, []);
  assert.deepEqual(groups[1].items, ["shared"]);
});

test("dropping where the item already exists puts it back", () => {
  const { $, dialog } = mountCi();
  dialog.show({
    enabled: true,
    groups: [{ name: "A", items: ["dup"] }, { name: "B", items: ["dup"] }]
  });

  dragChip($, 0, 0);
  (dialog as any).dropItem(1);

  const groups = (dialog as any).getState().groups;
  assert.deepEqual(groups[0].items, ["dup"], "returned to the source");
  assert.deepEqual(groups[1].items, ["dup"]);
});

test("dropping into the same group is a no-op", () => {
  const { $, dialog } = mountCi();
  dialog.show({ enabled: true, groups: [{ name: "A", items: ["x"] }] });

  dragChip($, 0, 0);
  (dialog as any).dropItem(0);

  assert.deepEqual((dialog as any).getState().groups[0].items, ["x"]);
});

test("disable clears the draft and reports it", async () => {
  const { dialog, disabled, statuses } = mountCi();
  dialog.show({ enabled: true, groups: [{ name: "A", items: ["x"] }] });

  await (dialog as any).disable();
  assert.equal(disabled(), 1);
  assert.equal((dialog as any).getState().enabled, false);
  assert.deepEqual((dialog as any).getState().groups, []);
  assert.match(statuses.at(-1).message, /Split disabled/);
});

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
globalThis.Element = win.Element;
globalThis.Node = win.Node;

const { SearchPicker } = await import("../components/search-picker.ts");

const OPTIONS = ["Permanent fix", "Workaround", "Known error"];

function openPicker(overrides: Record<string, unknown> = {}) {
  const anchor = win.document.createElement("div");
  win.document.body.appendChild(anchor);
  const picked: { value: string; intent: string }[] = [];
  let dismissed = 0;

  const picker = new SearchPicker(
    win.document.body,
    {},
    {
      anchor,
      options: OPTIONS,
      current: "",
      onPick: (value, intent) => picked.push({ value, intent }),
      onDismiss: () => dismissed++,
      ...overrides
    }
  );

  const pop = picker as unknown as { refs: SearchPickerRefs };
  return { picker, anchor, picked, dismissed: () => dismissed, pop };
}

type SearchPickerRefs = {
  pop: HTMLElement;
  input: HTMLInputElement;
  list: HTMLElement;
  foot: HTMLElement;
};

const key = (k: string, extra: Record<string, unknown> = {}) =>
  new win.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...extra });

test("picker lists every option plus a clear entry", () => {
  const { pop } = openPicker();
  const labels = [...pop.refs.list.querySelectorAll(".msrPickItem")].map((n) => n.textContent);
  assert.equal(labels[0], "— clear —");
  assert.deepEqual(labels.slice(1), OPTIONS);
  assert.equal(pop.refs.list.querySelectorAll(".msrPickItem.active").length, 1);
});

test("typing filters the list and Enter commits the exact match", () => {
  const { pop, picked } = openPicker();
  pop.refs.input.value = "work";
  pop.refs.input.dispatchEvent(new win.Event("input"));

  const labels = [...pop.refs.list.querySelectorAll(".msrPickItem")].map((n) => n.textContent);
  assert.deepEqual(labels, ["Workaround"]);

  pop.refs.input.dispatchEvent(key("Enter"));
  assert.deepEqual(picked, [{ value: "Workaround", intent: "enter" }]);
});

test("arrow keys move the active item and Enter commits it", () => {
  const { pop, picked } = openPicker();
  pop.refs.input.dispatchEvent(key("ArrowDown"));
  pop.refs.input.dispatchEvent(key("ArrowDown"));

  const active = pop.refs.list.querySelector(".msrPickItem.active");
  assert.equal(active?.textContent, "Workaround");

  pop.refs.input.dispatchEvent(key("Enter"));
  assert.deepEqual(picked, [{ value: "Workaround", intent: "enter" }]);
});

test("arrow up wraps to the last item", () => {
  const { pop } = openPicker();
  pop.refs.input.dispatchEvent(key("ArrowUp"));
  assert.equal(pop.refs.list.querySelector(".msrPickItem.active")?.textContent, "Known error");
});

test("Tab and Shift+Tab report the direction so callers can move the selection", () => {
  const forward = openPicker();
  forward.pop.refs.input.dispatchEvent(key("Tab"));
  assert.equal(forward.picked[0].intent, "tab");

  const back = openPicker();
  back.pop.refs.input.dispatchEvent(key("Tab", { shiftKey: true }));
  assert.equal(back.picked[0].intent, "tab-back");
});

test("committing with no matches keeps the picker open", () => {
  const { pop, picked } = openPicker();
  pop.refs.input.value = "zzzz";
  pop.refs.input.dispatchEvent(new win.Event("input"));

  // paintPickItems renders a "No matching option" placeholder with the same
  // class, so real matches must be counted excluding it.
  assert.equal(pop.refs.list.querySelectorAll(".msrPickItem:not(.none)").length, 0);
  assert.match(pop.refs.list.textContent, /No matching option/);

  pop.refs.input.dispatchEvent(key("Enter"));
  assert.deepEqual(picked, [], "nothing committed");
  assert.ok(pop.refs.pop.isConnected, "still open so the user can correct the query");
  assert.ok(pop.refs.input.classList.contains("invalid"), "and it flashes to say why");
});

test("Escape dismisses without committing", () => {
  const { pop, picked, dismissed } = openPicker();
  pop.refs.input.dispatchEvent(key("Escape"));

  assert.deepEqual(picked, []);
  assert.equal(dismissed(), 1);
  assert.equal(pop.refs.pop.isConnected, false);
});

test("an outside click dismisses, a click inside does not", () => {
  const { pop, dismissed } = openPicker();

  pop.refs.list.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
  assert.equal(dismissed(), 0, "clicks inside the popup are ignored");

  win.document.body.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
  assert.equal(dismissed(), 1);
});

test("clicking an item commits it with pointer intent", () => {
  const { pop, picked } = openPicker();
  const items = pop.refs.list.querySelectorAll(".msrPickItem");
  items[1].dispatchEvent(new win.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  assert.deepEqual(picked, [{ value: "Permanent fix", intent: "pointer" }]);
});

test("an off-list current value is offered and marked", () => {
  const { pop } = openPicker({ current: "Legacy value" });
  const labels = [...pop.refs.list.querySelectorAll(".msrPickItem")].map((n) => n.textContent);
  assert.ok(labels.some((l) => l?.includes("Legacy value · current")));
});

test("close() releases the document listener so a closed picker cannot dismiss", () => {
  const { picker, pop, dismissed } = openPicker();
  picker.close();

  assert.equal(pop.refs.pop.isConnected, false);
  win.document.body.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
  assert.equal(dismissed(), 0, "listener was removed");
});

test("commitNow commits from outside, as the grid does when moving cells", () => {
  const { picker, picked } = openPicker();
  assert.equal(picker.commitNow(), true);
  assert.deepEqual(picked, [{ value: "", intent: "enter" }], "clear entry is first");
});

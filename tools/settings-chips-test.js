import { test } from "node:test";
import assert from "node:assert/strict";
import "./helpers/dom-env.mjs";
import { splitTerms } from "../core/names.ts";
import { ChipList } from "../components/chip-list.ts";

function makeChip(opts = {}) {
  const root = document.createElement("div");
  return { root, chip: new ChipList(root, {}, opts) };
}

test("splitTerms splits on newlines, commas and semicolons", () => {
  assert.deepEqual(splitTerms("a\nb,c; d\n\n"), ["a", "b", "c", "d"]);
  assert.deepEqual(splitTerms(" Queue A ,queue B "), ["Queue A", "queue B"]);
});

test("splitTerms strips legacy Name | sys_id tails", () => {
  assert.deepEqual(splitTerms("Fred Luddy | 344"), ["Fred Luddy"]);
});

test("splitTerms dedups case-insensitively keeping first spelling", () => {
  assert.deepEqual(splitTerms("Beta\nbeta;BETA"), ["Beta"]);
});

test("splitTerms ignores empty and whitespace-only input", () => {
  assert.deepEqual(splitTerms("  \n,;"), []);
  assert.deepEqual(splitTerms(""), []);
});

test("chip list renders seeded values and commits typed terms", () => {
  const { root, chip } = makeChip({ placeholder: "Add…" });
  chip.setValues(["Alpha", "Beta"]);
  assert.deepEqual(chip.getValues(), ["Alpha", "Beta"]);
  assert.equal(root.querySelectorAll(".chip").length, 2);

  const input = root.querySelector(".chipInput");
  input.value = "Gamma";
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.deepEqual(chip.getValues(), ["Alpha", "Beta", "Gamma"]);
  assert.equal(input.value, "", "input cleared after commit");
});

test("chip list dedups duplicates and collapses case variants", () => {
  const { root, chip } = makeChip({});
  chip.setValues(["Alpha", "alpha"]);
  assert.deepEqual(chip.getValues(), ["Alpha"]);
  const input = root.querySelector(".chipInput");
  input.value = "BETA; beta, BETA";
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.deepEqual(chip.getValues(), ["Alpha", "BETA"]);
});

test("chip removal button removes only that chip", () => {
  const { root, chip } = makeChip({});
  chip.setValues(["One", "Two", "Three"]);
  const chips = root.querySelectorAll(".chip");
  chips[1].querySelector(".rm").click();
  assert.deepEqual(chip.getValues(), ["One", "Three"]);
});

test("backspace on empty input removes the last chip", () => {
  const { root, chip } = makeChip({});
  chip.setValues(["One", "Two"]);
  const input = root.querySelector(".chipInput");
  const ev = new window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
  for (let i = 0; i < 2; i++) input.dispatchEvent(ev);
  assert.deepEqual(chip.getValues(), []);
});

test("paste of a delimited list adds every term", () => {
  const { root, chip } = makeChip({});
  chip.setValues(["Alpha"]);
  const input = root.querySelector(".chipInput");
  const ev = new window.Event("paste", { bubbles: true, cancelable: true });
  ev.clipboardData = { getData: () => "Beta, Gamma; Delta" };
  input.dispatchEvent(ev);
  assert.deepEqual(chip.getValues(), ["Alpha", "Beta", "Gamma", "Delta"]);
});

test("blur commits pending input", () => {
  const { root, chip } = makeChip({});
  const input = root.querySelector(".chipInput");
  input.value = "Alpha";
  input.dispatchEvent(new window.FocusEvent("blur"));
  assert.deepEqual(chip.getValues(), ["Alpha"]);
});

test("collapsible list shows a scrollable card of stacked rows with an Edit button", () => {
  const { root, chip } = makeChip({ collapsible: true });
  chip.setValues(["Alpha", "Beta"]);
  assert.ok(root.querySelector(".chipCard"));
  assert.equal(root.querySelector(".chipEditBtn").textContent, "Edit");
  assert.equal(root.querySelector(".chipCount").textContent, "2 values");
  const rows = [...root.querySelectorAll(".chipRow")].map(r => r.textContent);
  assert.deepEqual(rows, ["Alpha", "Beta"]);
  assert.equal(root.querySelector(".chipStack").hidden, false);
  assert.equal(root.querySelector(".chipEditor").hidden, true);
  assert.deepEqual(chip.getValues(), ["Alpha", "Beta"]);
});

test("collapsible card switches to a text editor pre-filled with every value and Save returns the list", () => {
  const { root, chip } = makeChip({ collapsible: true });
  chip.setValues(["Alpha", "Beta"]);
  root.querySelector(".chipEditBtn").click();
  assert.equal(root.querySelector(".chipEditor").hidden, false);
  assert.equal(root.querySelector(".chipStack").hidden, true);
  const ta = root.querySelector(".chipTextarea");
  assert.equal(ta.value, "Alpha\nBeta");

  ta.value = "Alpha\nGamma;Delta\nOmega";
  root.querySelector(".chipActions .primary").click();
  assert.deepEqual(chip.getValues(), ["Alpha", "Gamma", "Delta", "Omega"]);
  assert.deepEqual([...root.querySelectorAll(".chipRow")].map(r => r.textContent),
    ["Alpha", "Gamma", "Delta", "Omega"]);
  assert.equal(root.querySelector(".chipCount").textContent, "4 values");
  assert.equal(root.querySelector(".chipEditBtn").textContent, "Edit");
});

test("collapsible card with no values shows the empty hint", () => {
  const { root } = makeChip({ collapsible: true });
  assert.equal(root.querySelector(".chipRow"), null);
  assert.equal(root.querySelector(".chipEmpty").hidden, false);
  assert.equal(root.querySelector(".chipCount").textContent, "0 values");
});

test("Cancel discards textarea changes and collapses to the saved list", () => {
  const { root, chip } = makeChip({ collapsible: true });
  chip.setValues(["Alpha"]);
  root.querySelector(".chipEditBtn").click();
  root.querySelector(".chipTextarea").value = "Beta";
  root.querySelector(".chipActions button:not(.primary)").click();
  assert.deepEqual(chip.getValues(), ["Alpha"]);
  assert.deepEqual([...root.querySelectorAll(".chipRow")].map(r => r.textContent), ["Alpha"]);
  assert.equal(root.querySelector(".chipEditor").hidden, true);
});

test("Escape in the textarea exits edit mode without saving", () => {
  const { root, chip } = makeChip({ collapsible: true });
  chip.setValues(["Alpha"]);
  root.querySelector(".chipEditBtn").click();
  const ta = root.querySelector(".chipTextarea");
  ta.value = "Beta";
  ta.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(root.querySelector(".chipEditor").hidden, true);
  assert.deepEqual(chip.getValues(), ["Alpha"], "typed text discarded on Escape");
});
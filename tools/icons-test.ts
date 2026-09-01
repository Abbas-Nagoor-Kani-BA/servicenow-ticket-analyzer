import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const win = new Window({ url: "https://viewer.local/" });
globalThis.window = win;
globalThis.document = win.document;
globalThis.HTMLElement = win.HTMLElement;
globalThis.HTMLInputElement = win.HTMLInputElement;
globalThis.Node = win.Node;

const { icon, iconButton, iconHTML } = await import("../lib/icons.ts");

test("lucide icon returns an inline svg sized by class", () => {
  const svg = icon("building-2");
  assert.ok(svg instanceof win.SVGSVGElement || svg.localName === "svg");
  assert.ok(svg.getAttribute("viewBox") === "0 0 24 24");
  assert.ok(svg.getAttribute("aria-hidden") === "true");
  assert.ok(svg.querySelector("path,circle,line"));
  svg.setAttribute("class", "foo");
  assert.ok(svg.getAttribute("class") === "foo");
});

test("iconHTML emits a string containing the svg markup", () => {
  const html = iconHTML("clock", "w-4");
  assert.ok(html.includes("<svg"));
  assert.ok(html.includes('class="w-4"'));
});

test("iconButton makes an icon-only button with a tooltip + aria-label", () => {
  const btn = iconButton("x-circle", "Close export");
  assert.equal(btn.tagName, "BUTTON");
  assert.ok(btn.classList.contains("icon-btn"));
  assert.equal(btn.getAttribute("data-tip"), "Close export");
  assert.equal(btn.getAttribute("aria-label"), "Close export");
  const svg = btn.querySelector("svg");
  assert.ok(svg, "button should contain an svg");
});

test("iconButton accepts size and extra cls", () => {
  const btn = iconButton("target", "tip", { cls: "extra", size: 20 });
  assert.ok(btn.classList.contains("extra"));
  const svg = btn.querySelector("svg");
  assert.equal(svg.getAttribute("width"), "20");
  assert.equal(svg.getAttribute("height"), "20");
});

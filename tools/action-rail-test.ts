import { test, before } from "node:test";
import assert from "node:assert/strict";

import { seedAll, seed, peek, flush, installSkeleton } from "./helpers/dom-env.mjs";
import { clampPosition } from "../surfaces/viewer/action-rail.ts";
import { STORAGE } from "../lib/keys.ts";

// clampPosition is pure and does not need the DOM.
test("clampPosition keeps the box within the viewport and below minTop", () => {
  // Fits: unchanged (but never above minTop).
  assert.deepEqual(clampPosition(100, 100, 40, 200, 1000, 800, 48), { x: 100, y: 100 });
  // Off the right/bottom: clamped to maxX/maxY.
  assert.deepEqual(clampPosition(9999, 9999, 40, 200, 1000, 800, 48), { x: 960, y: 600 });
  // Negative / above the toolbar: clamped to 0 / minTop.
  assert.deepEqual(clampPosition(-50, 10, 40, 200, 1000, 800, 48), { x: 0, y: 48 });
});

const FIXTURE = {
  lastData: { at: "2026-08-25T10:00:00Z", instance: "https://t", missingAudit: 0, totalPulled: 0, rows: [], runs: [] },
  pluginSettings: { defaults: { ticketType: "incident", queues: [], teamMembers: [] } },
  msrLists: undefined, viewerHiddenCols: [], viewerSel: null
};

before(async () => {
  installSkeleton();
  seedAll(FIXTURE);
  // Seed a persisted rail state to prove it is applied on boot.
  seed(STORAGE.viewerActionRail, { x: 120, y: 90, folded: true });
  Object.defineProperty(window, "innerWidth", { value: 1200, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
  await import("../surfaces/viewer/index.ts");
  await flush();
});

test("persisted folded state is applied on boot", () => {
  const rail = document.getElementById("actionRail");
  assert.ok(rail.classList.contains("folded"), "rail is folded per persisted state");
  const fold = document.getElementById("railFold");
  assert.equal(fold.getAttribute("data-tip"), "Expand", "fold button offers Expand while folded");
});

test("fold toggle flips the state and persists it", async () => {
  const rail = document.getElementById("actionRail");
  const fold = document.getElementById("railFold");
  fold.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await flush();
  assert.ok(!rail.classList.contains("folded"), "clicking fold expands the rail");
  assert.equal(peek(STORAGE.viewerActionRail).folded, false, "expanded state persisted");
  assert.equal(fold.getAttribute("data-tip"), "Collapse", "fold button now offers Collapse");
});

test("dragging the grip moves the rail and persists the position", async () => {
  const rail = document.getElementById("actionRail");
  const grip = document.getElementById("railGrip");
  grip.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, clientX: 200, clientY: 200, pointerId: 1 }));
  grip.dispatchEvent(new window.PointerEvent("pointermove", { bubbles: true, clientX: 260, clientY: 240, pointerId: 1 }));
  grip.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, clientX: 260, clientY: 240, pointerId: 1 }));
  await flush();
  // Inline position applied and persisted (exact px depends on happy-dom rects,
  // but left/top must be set and stored).
  assert.ok(rail.style.left !== "", "left inline style set after drag");
  assert.ok(rail.style.top !== "", "top inline style set after drag");
  const stored = peek(STORAGE.viewerActionRail);
  assert.equal(typeof stored.x, "number", "x persisted");
  assert.equal(typeof stored.y, "number", "y persisted");
});

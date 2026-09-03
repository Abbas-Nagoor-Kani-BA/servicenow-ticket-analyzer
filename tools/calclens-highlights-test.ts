import { test } from "node:test";
import assert from "node:assert/strict";

import { STORAGE } from "../lib/keys.ts";

// Back the module's loadOnce/saveValue with an in-memory chrome.storage.local
// before importing the module under test.
const store: Record<string, unknown> = {};
const fakeChrome = {
  storage: {
    local: {
      get: (keys: string[] | string) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of arr) if (k in store) out[k] = store[k];
        return Promise.resolve(out);
      },
      set: (obj: Record<string, unknown>) => {
        Object.assign(store, obj);
        return Promise.resolve();
      },
      remove: (keys: string[] | string) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) delete store[k];
        return Promise.resolve();
      }
    }
  }
};
Object.defineProperty(globalThis, "chrome", { value: fakeChrome, configurable: true, writable: true });

const {
  loadHighlightPrefs,
  isHighlightEnabled,
  setHighlightEnabled,
  setAll,
  enabledSet,
  enabledCount,
  disabledCount
} = await import("../surfaces/viewer/calclens-highlights.ts");

function reset(): void {
  for (const k of Object.keys(store)) delete store[k];
}

test("defaults to all highlights enabled", async () => {
  reset();
  await loadHighlightPrefs();
  assert.equal(disabledCount(), 0);
  assert.equal(enabledCount(), 9);
  assert.ok(isHighlightEnabled("reopened"));
  assert.equal(enabledSet().size, 9);
});

test("disabling a rule persists only the disabled id", async () => {
  reset();
  await loadHighlightPrefs();
  setHighlightEnabled("reopened", false);
  assert.equal(isHighlightEnabled("reopened"), false);
  assert.deepEqual(store[STORAGE.calclensHighlights], ["reopened"]);
  // Re-enable clears it back out of the persisted payload.
  setHighlightEnabled("reopened", true);
  assert.deepEqual(store[STORAGE.calclensHighlights], []);
  assert.ok(isHighlightEnabled("reopened"));
});

test("persisted disabled ids are restored on load", async () => {
  reset();
  store[STORAGE.calclensHighlights] = ["slaBreach", "emptyPlan"];
  await loadHighlightPrefs();
  assert.equal(isHighlightEnabled("slaBreach"), false);
  assert.equal(isHighlightEnabled("emptyPlan"), false);
  assert.equal(isHighlightEnabled("reopened"), true);
  assert.equal(disabledCount(), 2);
});

test("unknown stored ids are ignored", async () => {
  reset();
  store[STORAGE.calclensHighlights] = ["notARule", "reopened"];
  await loadHighlightPrefs();
  assert.equal(disabledCount(), 1, "only the known id is kept");
  assert.equal(isHighlightEnabled("reopened"), false);
});

test("setAll(false) disables everything; setAll(true) re-enables", async () => {
  reset();
  await loadHighlightPrefs();
  setAll(false);
  assert.equal(disabledCount(), 9);
  assert.equal(enabledCount(), 0);
  assert.equal((store[STORAGE.calclensHighlights] as unknown[]).length, 9);
  setAll(true);
  assert.equal(disabledCount(), 0);
  assert.deepEqual(store[STORAGE.calclensHighlights], []);
});

test("setHighlightEnabled ignores unknown ids", async () => {
  reset();
  await loadHighlightPrefs();
  setHighlightEnabled("notARule", false);
  assert.equal(disabledCount(), 0);
});

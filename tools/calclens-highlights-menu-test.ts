import { test, before } from "node:test";
import assert from "node:assert/strict";

import { seedAll, flush, installSkeleton, peek } from "./helpers/dom-env.mjs";
import { ATTENTION_RULES } from "../core/attention.ts";
import { STORAGE } from "../lib/keys.ts";

const FIXTURE = {
  lastData: {
    at: "2026-08-25T10:00:00Z",
    instance: "https://test.service-now.com",
    missingAudit: 0,
    totalPulled: 1,
    rows: [
      {
        sysId: "aaa", number: "INC0001001", shortDescription: "First ticket",
        state: "Closed", stateValue: "7", priority: "3 - Moderate",
        assignmentGroup: "APPSUP_TEST", assignedTo: "John Doe",
        createdOn: "01-08-2026 10:00:00", closeNotes: "", solutionType: "", rootCause: ""
      }
    ],
    runs: [{ at: "2026-08-25T10:00:00Z", table: "incident", group: "APPSUP_TEST", pulled: 1 }]
  },
  pluginSettings: {
    defaults: { ticketType: "incident", queues: ["APPSUP_TEST"], teamMembers: ["John Doe"] }
  },
  msrLists: undefined,
  viewerHiddenCols: [],
  viewerSel: null
};

before(async () => {
  installSkeleton();
  seedAll(FIXTURE);
  await import("../surfaces/viewer/index.ts");
  await flush();
});

function openMenu(): void {
  const menu = document.getElementById("calclensMenu")!;
  if (menu.classList.contains("hidden")) {
    document.getElementById("calclensMenuBtn")!.dispatchEvent(new window.Event("click", { bubbles: true }));
  }
}

test("dropdown lists all nine rules with their labels", { timeout: 8000 }, async () => {
  openMenu();
  await flush();
  const labels = [...document.querySelectorAll("#calclensHlList label span")].map((s) => s.textContent);
  assert.equal(labels.length, ATTENTION_RULES.length, "one row per rule");
  for (const rule of ATTENTION_RULES) {
    assert.ok(labels.includes(rule.label), `menu lists "${rule.label}"`);
  }
  const boxes = [...document.querySelectorAll<HTMLInputElement>("#calclensHlList input[type=checkbox]")];
  assert.ok(boxes.every((b) => b.checked), "all rules start enabled");
});

test("toggling a rule off persists it and updates the button indicator", { timeout: 8000 }, async () => {
  openMenu();
  await flush();
  const boxes = [...document.querySelectorAll<HTMLInputElement>("#calclensHlList input[type=checkbox]")];
  // Uncheck the first rule (multiAssignWithinTeam).
  boxes[0].checked = false;
  boxes[0].dispatchEvent(new window.Event("change", { bubbles: true }));
  await flush();

  const persisted = peek(STORAGE.calclensHighlights);
  assert.deepEqual(persisted, [ATTENTION_RULES[0].id], "only the disabled id is persisted");

  const btnText = document.getElementById("calclensBtn")!.textContent ?? "";
  assert.ok(btnText.includes("(1 hidden)"), `button shows the hidden count, got "${btnText}"`);
});

test("Hide all unchecks every rule; Show all re-checks", { timeout: 8000 }, async () => {
  openMenu();
  await flush();
  document.getElementById("calclensHideAll")!.dispatchEvent(new window.Event("click", { bubbles: true }));
  await flush();
  let boxes = [...document.querySelectorAll<HTMLInputElement>("#calclensHlList input[type=checkbox]")];
  assert.ok(boxes.every((b) => !b.checked), "Hide all unchecks everything");
  assert.equal((peek(STORAGE.calclensHighlights) as unknown[]).length, ATTENTION_RULES.length);

  document.getElementById("calclensShowAll")!.dispatchEvent(new window.Event("click", { bubbles: true }));
  await flush();
  boxes = [...document.querySelectorAll<HTMLInputElement>("#calclensHlList input[type=checkbox]")];
  assert.ok(boxes.every((b) => b.checked), "Show all re-checks everything");
  assert.deepEqual(peek(STORAGE.calclensHighlights), []);
  const btnText = document.getElementById("calclensBtn")!.textContent ?? "";
  assert.ok(!btnText.includes("hidden"), "button indicator clears when all enabled");
});

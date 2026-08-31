import { test } from "node:test";
import assert from "node:assert/strict";

import { hashNotes, alreadyClassified } from "../surfaces/viewer/classify.ts";

test("hashNotes is deterministic and sensitive to the note text", () => {
  assert.equal(hashNotes("Restarted the server"), hashNotes("Restarted the server"));
  assert.notEqual(hashNotes("Restarted the server"), hashNotes("Restarted the server now"));
});

test("alreadyClassified is true only when both fields set AND notes unchanged", () => {
  const notes = "Disk failure, replaced the drive.";
  const h = hashNotes(notes);
  assert.equal(alreadyClassified({ rootCause: "Hardware", solutionType: "Workaround solution", notesHash: h }, notes), true);
  // Missing one field -> not fully classified.
  assert.equal(alreadyClassified({ rootCause: "Hardware", solutionType: "", notesHash: h }, notes), false);
  // note changed -> must re-classify.
  assert.equal(alreadyClassified({ rootCause: "Hardware", solutionType: "Workaround solution", notesHash: hashNotes("Different note") }, notes), false);
  // No recorded baseline -> assume it may have changed.
  assert.equal(alreadyClassified({ rootCause: "Hardware", solutionType: "Workaround solution" }, notes), false);
});

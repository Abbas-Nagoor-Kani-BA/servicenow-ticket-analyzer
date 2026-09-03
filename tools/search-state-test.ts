import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getSearchColumn, setSearchColumn,
  getSearchMode, setSearchMode,
  isCaseSensitive, setCaseSensitive
} from "../surfaces/viewer/search-state.ts";

test("defaults reproduce the original all-column substring search", () => {
  assert.equal(getSearchColumn(), "");
  assert.equal(getSearchMode(), "contains");
  assert.equal(isCaseSensitive(), false);
});

test("column setter accepts a key and rejects non-strings", () => {
  setSearchColumn("state");
  assert.equal(getSearchColumn(), "state");
  setSearchColumn(undefined as unknown as string);
  assert.equal(getSearchColumn(), "");
});

test("mode setter validates the enum, falling back to contains", () => {
  for (const m of ["equals", "notContains", "notEquals", "contains"] as const) {
    setSearchMode(m);
    assert.equal(getSearchMode(), m);
  }
  setSearchMode("bogus" as unknown as "contains");
  assert.equal(getSearchMode(), "contains");
});

test("case sensitivity is a boolean toggle", () => {
  setCaseSensitive(true);
  assert.equal(isCaseSensitive(), true);
  setCaseSensitive(false);
  assert.equal(isCaseSensitive(), false);
});

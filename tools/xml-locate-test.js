import { test } from "node:test";
import assert from "node:assert/strict";

import { rowTextsByColumnA, rowNumbersByColumnAText } from "../core/templatexml.ts";

// Shared strings referenced by t="s" cells below.
const sst = ["Key Incidents this week", "Changes implemented this week", "Changes Planned"];

// A worksheet fragment exercising every column-A cell encoding the locate path
// must handle:
//   - inline string  (row 2:  <is><t>...)
//   - shared-string   (rows 5, 9, 14: t="s"><v>idx)
//   - a gap            (no rows 3,4,6,7,8,11,13 — rows are sparse)
//   - self-closing A   (row 10: <c r="A10" s="5"/>  -> empty text)
//   - literal <v>      (row 12: numeric value, no type)
//   - xml:space + entity in inline text (row 2)
const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="A1:H40"/>
<sheetData>
<row r="2"><c r="A2" s="3" t="inlineStr"><is><t xml:space="preserve">Highlights &amp; lowlights</t></is></c><c r="B2" s="3"/></row>
<row r="5"><c r="A5" t="s"><v>0</v></c><c r="C5" t="inlineStr"><is><t>Incident Number</t></is></c></row>
<row r="9"><c r="A9" t="s"><v>1</v></c></row>
<row r="10"><c r="A10" s="5"/><c r="C10" s="5"/></row>
<row r="12"><c r="A12"><v>46253.5</v></c></row>
<row r="14"><c r="A14" t="s"><v>2</v></c></row>
</sheetData></worksheet>`;

test("rowNumbersByColumnAText matches rowTextsByColumnA (parity)", () => {
  const regexOut = rowTextsByColumnA(sheetXml, sst);
  const parserOut = rowNumbersByColumnAText(sheetXml, sst);
  // Same rows in the same order.
  assert.deepEqual(parserOut.map((r) => r.rowNum), regexOut.map((r) => r.rowNum));
  // Text is identical after decoding XML entities. The regex helper returns the
  // raw <t> bytes for inline strings (it does not decode &amp; etc.), whereas
  // the parser decodes them — the more correct behavior. Section-header lookup
  // uses normLabel().includes() on entity-free titles, so this difference does
  // not change which row findRowIn locates; the test pins it explicitly.
  const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  assert.deepEqual(parserOut.map((r) => r.text), regexOut.map((r) => decode(r.text)));
});

test("rowNumbersByColumnAText resolves each column-A encoding", () => {
  const out = rowNumbersByColumnAText(sheetXml, sst);
  const byRow = Object.fromEntries(out.map((r) => [r.rowNum, r.text]));
  assert.equal(byRow[2], "Highlights & lowlights", "inline string with entity + xml:space");
  assert.equal(byRow[5], "Key Incidents this week", "shared-string index 0");
  assert.equal(byRow[9], "Changes implemented this week", "shared-string index 1");
  assert.equal(byRow[10], "", "self-closing A cell => empty");
  assert.equal(byRow[12], "46253.5", "literal numeric <v>");
  assert.equal(byRow[14], "Changes Planned", "shared-string index 2");
});

test("rowNumbersByColumnAText preserves sparse row order and skips missing rows", () => {
  const out = rowNumbersByColumnAText(sheetXml, sst);
  assert.deepEqual(out.map((r) => r.rowNum), [2, 5, 9, 10, 12, 14]);
});

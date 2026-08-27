#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fflate from "../lib/vendor/fflate.cjs";
import * as T from "../lib/templatexml.js";
import { } from "../lib/markup.js";
import { setFflate } from "../lib/templatexml.js";

setFflate(fflate);

let failed = 0;
function check(name, ok, detail) {
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok || !detail ? "" : ` — ${detail}`}`);
}
const enc = s => new TextEncoder().encode(s);
const decode = (files, k) => Buffer.from(files[k] || new Uint8Array()).toString();

const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>
</Types>`;
const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="All_Ticket_Details" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/>
</Relationships>`;
const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:E3"/>
<sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>S.No</t></is></c><c r="E1" t="inlineStr"><is><t>Reference Number</t></is></c></row>
<row r="2"><c r="A2" s="4"/><c r="E2" s="7" t="inlineStr"><is><t>INCOLD</t></is></c></row>
</sheetData></worksheet>`;
const fixtureBuf = fflate.zipSync({
  "[Content_Types].xml": enc(ct),
  "_rels/.rels": enc(rootRels),
  "xl/workbook.xml": enc(wb),
  "xl/_rels/workbook.xml.rels": enc(wbRels),
  "xl/calcChain.xml": enc(`<?xml version="1.0"?><calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>`),
  "xl/worksheets/sheet1.xml": enc(sheet)
}, { level: 0 });

console.log("== fillTemplateBuffer (legacy template surgery) ==");
const rows = [
  { number: "INC0001001", priority: "3 - Moderate", state: "Closed" },
  { number: "INC0001002", priority: "4 - Low", state: "In Progress" }
];
const tplCols = [
  { col: 1, get: () => "" },
  { col: 5, get: r => r.number },
  { col: 7, get: r => (String(r.priority).match(/\d+/) || [""])[0] }
];
let out;
try {
  out = T.fillTemplateBuffer(fixtureBuf, rows, tplCols);
  check("fillTemplateBuffer completes", true);
} catch (err) {
  check("fillTemplateBuffer completes", false, err.message);
  process.exit(1);
}
const files = fflate.unzipSync(new Uint8Array(out));
const xml = decode(files, "xl/worksheets/sheet1.xml");

check("header row preserved verbatim", xml.includes(">Reference Number<"));
check("old data row replaced", !xml.includes("INCOLD"));
check("row numbers written as inline strings", xml.includes("INC0001001") && xml.includes("INC0001002"));
check("numeric cell emitted for G column", /<c r="G2"[^>]*><v>3<\/v><\/c>/.test(xml), (xml.match(/<c r="G2"[^>]*>([\s\S]{0,60})/) || [])[1]);
check("styled blank kept for mapped-empty A col", /<c r="A2" s="4"\/>/.test(xml));
check("dimension extended to last mapped column", /<dimension ref="A1:G3"\/>/.test(xml),
  (xml.match(/<dimension ref="([^"]*)"/) || [])[1]);
check("calcChain stripped + fullCalcOnLoad set",
  !files["xl/calcChain.xml"] && /fullCalcOnLoad="1"/.test(decode(files, "xl/workbook.xml")));
check("calcChain content-type override pruned", !decode(files, Object.keys(files).find(k => k.toLowerCase() === "[content_types].xml")).includes("calcChain"));
check("helper exports present",
  typeof T.normSheetName === "function" && typeof T.findTargetSheetPath === "function");

const realPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sample.xlsx");
if (fs.existsSync(realPath)) {
  console.log("\n== real sample.xlsx ==");
  const rf = fflate.unzipSync(new Uint8Array(fs.readFileSync(realPath)));
  const p = T.findTargetSheetPath(rf, "All_Ticket_Details");
  check("[real] finds All_Ticket_Details sheet", !!p, String(p));
  const sst = T.parseSharedStrings(rf);
  const hr = T.findHeaderRowInXml(Buffer.from(rf[p]).toString(), sst);
  check("[real] header detected via E-column reference", hr >= 1, "row " + hr);
} else {
  console.log("\n(skip) sample.xlsx not found at repo root");
}

console.log(`\ntemplate-export: ${failed ? failed + " FAILED" : "all passed"}`);
process.exit(failed ? 1 : 0);

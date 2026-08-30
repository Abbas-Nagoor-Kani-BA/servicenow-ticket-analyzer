#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fflate from "../lib/vendor/fflate.cjs";
import * as T from "../core/templatexml.ts";
import { } from "../lib/markup.ts";
import { setFflate } from "../core/templatexml.ts";

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

console.log("\n== patchSummarySlaSheet ==");
const sumCt = ct.replace('PartName="/xl/worksheets/sheet1.xml"', 'PartName="/xl/worksheets/sheet1.xml"')
  + `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
const sumWb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="All_Ticket_Details" sheetId="1" r:id="rId1"/><sheet name="Summary SLA" sheetId="2" r:id="rId2"/></sheets>
<calcPr calcId="191028"/>
</workbook>`;
const sumWbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`;
const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="20" uniqueCount="20">
<si><t>Service Metric</t></si><si><t>Time to Resolve</t></si>
<si><t>Time to Respond</t></si><si><t>Incident</t></si>
<si><t>Severity 1 Incidents</t></si><si><t>Within 1 hour </t></si>
<si><t>Within 4 hours</t></si><si><t>Severity 2 Incidents</t></si>
<si><t>Within 6 hours</t></si><si><t>Severity 4 Incidents</t></si>
<si><t>Within 3 business hours</t></si><si><t>Known Error Logging</t></si>
<si><t>Problem</t></si><si><t>All other priorities except High</t></si>
<si><t>Plan of action detailing options, dependencies, risks and timescales for fixing the problem to be available within 20 working days</t></si>
<si><t>Reoccuring Incident - Problem creation</t></si><si><t>All </t></si>
<si><t>Problem creation for reoccuring problems </t></si>
<si><t>Unmatched label</t></si>
</sst>`;
const sumSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="C4:K30"/>
<sheetData>
<row r="4"><c r="C4" t="inlineStr"><is><t>Service Metric</t></is></c><c r="F4" t="inlineStr"><is><t>SLA</t></is></c><c r="G4" s="39"/><c r="I4" t="inlineStr"><is><t>Count of Incidents</t></is></c><c r="J4" t="inlineStr"><is><t>Total Incidents</t></is></c><c r="K4" t="inlineStr"><is><t>Actual Status</t></is></c></row>
<row r="5"><c r="C5" s="1" t="s"><v>1</v></c><c r="D5" t="s"><v>3</v></c><c r="E5" t="s"><v>4</v></c><c r="F5" s="1" t="s"><v>5</v></c><c r="G5" s="40"><v>0.85</v></c><c r="H5" s="93"><f>IFS(J5=0,0,J5&lt;&gt;0,(I5/J5)*1)</f><v>0</v></c><c r="K5" s="94"><f>IFS(J5=0,&quot;GREEN&quot;,H5&gt;=0.85,&quot;GREEN&quot;,H5&lt;0.85,&quot;AMBER&quot;)</f><v>0</v></c></row>
<row r="6"><c r="F6" t="s"><v>6</v></c><c r="G6" s="40"><v>1</v></c><c r="H6" s="93"><f>IFS(J6=0,0,J6&lt;&gt;0,(I6/J6)*1)</f><v>0</v></c><c r="I6" s="73"><v>1</v></c><c r="J6" s="73"><v>2</v></c><c r="K6" s="94" t="inlineStr"><is><t>GREEN</t></is></c></row>
<row r="7"><c r="E7" t="s"><v>7</v></c><c r="F7" t="s"><v>8</v></c><c r="G7" s="40"><v>0.95</v></c><c r="H7" s="93"><f>IFS(J7=0,0,J7&lt;&gt;0,(I7/J7)*1)</f><v>0</v></c><c r="I7" s="73"><v>1</v></c><c r="J7" s="73"><v>1</v></c></row>
<row r="8"><c r="C8" s="1" t="s"><v>2</v></c><c r="D8" t="s"><v>3</v></c><c r="E8" t="s"><v>9</v></c><c r="F8" s="1" t="s"><v>10</v></c><c r="G8" s="40"><v>1</v></c><c r="H8" s="93"><v>1</v></c><c r="K8" s="94" t="inlineStr"><is><t>GREEN</t></is></c></row>
<row r="22"><c r="C22" s="1" t="s"><v>11</v></c><c r="D22" t="s"><v>12</v></c><c r="E22" t="s"><v>13</v></c><c r="F22" s="1" t="s"><v>14</v></c><c r="G22" s="40"><v>1</v></c><c r="H22" s="93"><f>IFS(J22=0,0,J22&lt;&gt;0,(I22/J22)*1)</f><v>0</v></c><c r="K22" s="94" t="inlineStr"><is><t>GREEN</t></is></c></row>
<row r="23"><c r="C23" t="s"><v>15</v></c><c r="D23" s="1" t="s"><v>12</v></c><c r="E23" t="s"><v>16</v></c><c r="F23" s="1" t="s"><v>17</v></c><c r="G23" s="40"><v>1</v></c><c r="H23" s="93"><f>IFS(J23=0,0,J23&lt;&gt;0,(I23/J23)*1)</f><v>0</v></c><c r="I23" s="73"><v>0</v></c><c r="J23" s="73"><v>0</v></c></row>
<row r="30"><c r="C30" s="1" t="s"><v>1</v></c><c r="E30" t="s"><v>4</v></c><c r="F30" t="s"><v>18</v></c><c r="G30" s="40"><v>1</v></c><c r="I30" s="73"><v>5</v></c><c r="J30" s="73"><v>5</v></c></row>
</sheetData></worksheet>`;
const sumFixture = fflate.zipSync({
  "[Content_Types].xml": enc(sumCt),
  "_rels/.rels": enc(rootRels),
  "xl/workbook.xml": enc(sumWb),
  "xl/_rels/workbook.xml.rels": enc(sumWbRels),
  "xl/sharedStrings.xml": enc(sst),
  "xl/worksheets/sheet1.xml": enc(sheet),
  "xl/worksheets/sheet2.xml": enc(sumSheet)
}, { level: 0 });

const summaryItems = [
  { metric: "Time to Resolve", ticketType: "Incident", category: "Severity 1 Incidents", sla: "Within 1 hour ", target: 0.85, count: 7, total: 10, actual: 0.7, status: "AMBER", writeStatus: true },
  { metric: "Time to Resolve", ticketType: "Incident", category: "Severity 1 Incidents", sla: "Within 4 hours", target: 1, count: 9, total: 10, actual: 0.9, status: "GREEN", writeStatus: true },
  { metric: "Time to Resolve", ticketType: "Incident", category: "Severity 2 Incidents", sla: "Within 6 hours", target: 0.95, count: 5, total: 6, actual: 0.83, status: "AMBER", writeStatus: true },
  { metric: "Time to Respond", ticketType: "Incident", category: "Severity 4 Incidents", sla: "Within 3 business hours", target: 1, count: 2, total: 4, actual: 0.5, status: "RED", writeStatus: true },
  { metric: "Known Error Logging", ticketType: "Problem", category: "All other priorities except High", sla: "Plan of action detailing options, dependencies, risks and timescales for fixing the problem to be available within 20 working days", target: 1, count: 3, total: 4, actual: 0.75, status: "AMBER", writeStatus: false },
  { metric: "Reoccuring Incident - Problem creation", ticketType: "Problem", category: "All ", sla: "Problem creation for reoccuring problems ", target: 1, count: 3, total: 5, actual: 0.6, status: "GREEN", writeStatus: false }
];

let sumOut;
try {
  sumOut = T.fillTemplateBuffer(sumFixture, rows, tplCols, undefined, summaryItems);
  check("summary export completes", true);
} catch (err) {
  check("summary export completes", false, err.message);
  process.exit(1);
}
const sumFiles = fflate.unzipSync(new Uint8Array(sumOut));
const sxml = decode(sumFiles, "xl/worksheets/sheet2.xml");

check("missing I/J cells inserted with fallback style", /<c r="I5" s="40"><v>7<\/v><\/c>/.test(sxml) && /<c r="J5" s="40"><v>10<\/v><\/c>/.test(sxml));
check("H formula left untouched", /<c r="H5" s="93"><f>IFS\(J5=0,0/.test(sxml));
check("K formula cell untouched", /<c r="K5" s="94"><f>IFS/.test(sxml));
check("existing numeric count overwritten", /<c r="I6" s="73"><v>9<\/v><\/c>/.test(sxml) && /<c r="J6" s="73"><v>10<\/v><\/c>/.test(sxml));
check("literal K replaced with status text", /<c r="K6" s="94" t="inlineStr"><is><t xml:space="preserve">GREEN<\/t><\/is><\/c>/.test(sxml));
check("carry-forward only: row 7 uses own E/F", /<c r="I7" s="73"><v>5<\/v><\/c>/.test(sxml) && /<c r="J7" s="73"><v>6<\/v><\/c>/.test(sxml));
check("literal actual overwritten on respond row", /<c r="H8" s="93"><v>0.5<\/v><\/c>/.test(sxml));
check("respond I/J filled", /<c r="I8" s="40"><v>2<\/v><\/c>/.test(sxml) && /<c r="J8" s="40"><v>4<\/v><\/c>/.test(sxml));
check("respond K text replaced", /<c r="K8" s="94" t="inlineStr"><is><t xml:space="preserve">RED<\/t><\/is><\/c>/.test(sxml));
check("block2 count/total filled", /<c r="I22" s="40"><v>3<\/v><\/c>/.test(sxml) && /<c r="J22" s="40"><v>4<\/v><\/c>/.test(sxml));
check("block2 K untouched (writeStatus false)", /<c r="K22" s="94" t="inlineStr"><is><t>GREEN<\/t><\/is><\/c>/.test(sxml));
check("row 23 count/total overwritten", /<c r="I23" s="73"><v>3<\/v><\/c>/.test(sxml) && /<c r="J23" s="73"><v>5<\/v><\/c>/.test(sxml));
check("unmatched row untouched", /<c r="I30" s="73"><v>5<\/v><\/c>/.test(sxml));
check("fullCalcOnLoad forced without calcChain.xml", /fullCalcOnLoad="1"/.test(decode(sumFiles, "xl/workbook.xml")));

export function patchSummarySlaSheetMissingSheet() {
  let out2;
  try {
    out2 = T.fillTemplateBuffer(fixtureBuf, rows, tplCols, undefined, summaryItems);
    check("missing summary sheet is a silent no-op", true);
  } catch (err) {
    check("missing summary sheet is a silent no-op", false, err.message);
    process.exit(1);
  }
  check("no summary sheet added to zip", !fflate.unzipSync(new Uint8Array(out2))["xl/worksheets/sheet2.xml"]);
  check("main sheet still filled", decode(fflate.unzipSync(new Uint8Array(out2)), "xl/worksheets/sheet1.xml").includes("INC0001001"));
}
patchSummarySlaSheetMissingSheet();

console.log(`\ntemplate-export: ${failed ? failed + " FAILED" : "all passed"}`);
process.exit(failed ? 1 : 0);

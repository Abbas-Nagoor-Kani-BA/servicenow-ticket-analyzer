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

console.log("\n== patchSummaryDetailsSheet ==");
// Summary cover sheet fixture mirroring the real WSR layout (section headers +
// column-header row + data rows). Column A carries the section titles.
const sdWb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="All_Ticket_Details" sheetId="1" r:id="rId1"/><sheet name="Summary" sheetId="2" r:id="rId2"/></sheets>
<calcPr calcId="191028"/>
</workbook>`;
const sdSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:H40"/>
<sheetData>
<row r="2"><c r="A2" s="3" t="inlineStr"><is><t>Highlights: NA</t></is></c></row>
<row r="14"><c r="A14" t="inlineStr"><is><t>Key Incidents (Sev1, Sev2 or Business sensitive) this week</t></is></c></row>
<row r="15"><c r="A15" t="inlineStr"><is><t>Resolution Date</t></is></c><c r="C15" t="inlineStr"><is><t>Incident Number</t></is></c></row>
<row r="16"><c r="A16" s="5"/><c r="C16" s="5"/></row>
<row r="17"><c r="A17" t="inlineStr"><is><t>Changes implemented this week</t></is></c></row>
<row r="18"><c r="A18" t="inlineStr"><is><t>Implementation Date</t></is></c><c r="C18" t="inlineStr"><is><t>CR Number</t></is></c></row>
<row r="19"><c r="A19" s="5"/><c r="C19" s="5"/></row>
<row r="20"><c r="A20" s="5"/><c r="C20" s="5"/></row>
<row r="25"><c r="A25" t="inlineStr"><is><t>Changes Planned</t></is></c></row>
<row r="26"><c r="A26" t="inlineStr"><is><t>Implementation Date</t></is></c><c r="C26" t="inlineStr"><is><t>CR Number</t></is></c></row>
<row r="27"><c r="A27" s="5"/><c r="C27" s="5"/></row>
<row r="31"><c r="A31" t="inlineStr"><is><t>Changes Failed this week</t></is></c></row>
<row r="32"><c r="A32" t="inlineStr"><is><t>Implementation Date</t></is></c><c r="C32" t="inlineStr"><is><t>CR Number</t></is></c></row>
<row r="33"><c r="A33" t="inlineStr"><is><t>None</t></is></c></row>
<row r="34"><c r="A34" t="inlineStr"><is><t>Operational Health</t></is></c></row>
<row r="35"><c r="A35" t="inlineStr"><is><t>No impact.</t></is></c></row>
</sheetData></worksheet>`;
const sdFixture = fflate.zipSync({
  "[Content_Types].xml": enc(sumCt),
  "_rels/.rels": enc(rootRels),
  "xl/workbook.xml": enc(sdWb),
  "xl/_rels/workbook.xml.rels": enc(sumWbRels),
  "xl/sharedStrings.xml": enc(sst),
  "xl/worksheets/sheet1.xml": enc(sheet),
  "xl/worksheets/sheet2.xml": enc(sdSheet)
}, { level: 0 });

const summaryDetails = {
  keyIncidents: [
    { resolutionDate: 46253.5, systemArea: "RMS (prd)", incidentNumber: "INC2558027", details: "Arrival tasks", status: "Closed", rootCauseResolution: "RC narrative" }
  ],
  changesImplemented: [
    { date: 46253.25, systemArea: "RMS (prd)", crNumber: "CHG0260966", details: "BaseData updates" },
    { date: 46251.98, systemArea: "OPS (prd)", crNumber: "CHG0260607", details: "Dashboard reqs" }
  ],
  changesPlanned: [
    { date: 46259.54, systemArea: "RMS BAGGAGE (prd)", crNumber: "CHG0262212", details: "New ETL job" }
  ],
  changesFailed: [
    { date: 46252.2, systemArea: "BROCK (prd)", crNumber: "CHG0261128", details: "Azure patching" }
  ],
  narrative: { A2: "Highlights: all good", A35: "No operational impact this week." }
};

let sdOut;
try {
  sdOut = T.fillTemplateBuffer(sdFixture, rows, tplCols, undefined, undefined, summaryDetails);
  check("summary-details export completes", true);
} catch (err) {
  check("summary-details export completes", false, err.message);
  process.exit(1);
}
const sdFiles = fflate.unzipSync(new Uint8Array(sdOut));
const dxml = decode(sdFiles, "xl/worksheets/sheet2.xml");

check("key incident number written to C16", /<c r="C16"[^>]*t="inlineStr"><is><t xml:space="preserve">INC2558027<\/t><\/is><\/c>/.test(dxml));
check("key incident resolution date as serial A16", /<c r="A16"[^>]*><v>46253.5<\/v><\/c>/.test(dxml));
check("key incident status to F16", /<c r="F16"[^>]*>INC|<c r="F16"[^>]*t="inlineStr"><is><t xml:space="preserve">Closed<\/t>/.test(dxml));
check("key incident root cause to G16", /<c r="G16"[^>]*t="inlineStr"><is><t xml:space="preserve">RC narrative<\/t>/.test(dxml));
check("implemented CR1 to C19", /<c r="C19"[^>]*t="inlineStr"><is><t xml:space="preserve">CHG0260966<\/t>/.test(dxml));
check("implemented CR2 to C20", /<c r="C20"[^>]*t="inlineStr"><is><t xml:space="preserve">CHG0260607<\/t>/.test(dxml));
check("planned CR to C27", /<c r="C27"[^>]*t="inlineStr"><is><t xml:space="preserve">CHG0262212<\/t>/.test(dxml));
check("failed CR to C33 (overwrites None)", /<c r="C33"[^>]*t="inlineStr"><is><t xml:space="preserve">CHG0261128<\/t>/.test(dxml));
check("narrative A2 written", /<c r="A2"[^>]*t="inlineStr"><is><t xml:space="preserve">Highlights: all good<\/t>/.test(dxml));
check("narrative A35 written", /<c r="A35"[^>]*t="inlineStr"><is><t xml:space="preserve">No operational impact this week.<\/t>/.test(dxml));
check("section header row 17 untouched", /Changes implemented this week/.test(dxml));

// Missing Summary sheet => silent no-op
let sdOut2;
try {
  sdOut2 = T.fillTemplateBuffer(fixtureBuf, rows, tplCols, undefined, undefined, summaryDetails);
  check("missing Summary sheet is a silent no-op", !!sdOut2 && !fflate.unzipSync(new Uint8Array(sdOut2))["xl/worksheets/sheet2.xml"]);
} catch (err) {
  check("missing Summary sheet is a silent no-op", false, err.message);
}

// Real wsr-sample.xlsx if present
const wsrPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "wsr-sample.xlsx");
if (fs.existsSync(wsrPath)) {
  console.log("\n== real wsr-sample.xlsx (Summary) ==");
  const rf = fflate.unzipSync(new Uint8Array(fs.readFileSync(wsrPath)));
  const p = T.findTargetSheetPath(rf, "Summary");
  check("[real] finds Summary sheet", !!p, String(p));
  const sst2 = T.parseSharedStrings(rf);
  const n = T.patchSummaryDetailsSheet(rf, sst2, summaryDetails);
  check("[real] patchSummaryDetailsSheet wrote rows", n >= 4, "wrote " + n);
  const realXml = Buffer.from(rf[p]).toString();
  check("[real] CR number appears on Summary sheet", realXml.includes("CHG0260966"));
} else {
  console.log("\n(skip) wsr-sample.xlsx not found at repo root");
}

// --- Section growth: more rows than template slots must all be written ---
// sdSheet: implemented header row 17, data starts 19, planned header row 25
// => 6 slots (19..24). Feed 9 implemented rows (overflow of 3): all must land,
// and the Planned / Failed / Operational Health sections must shift down by 3.
console.log("\n== summary-details section growth (overflow) ==");
{
  const many = [];
  for (let i = 1; i <= 9; i++) {
    many.push({ date: 46250 + i, systemArea: `SYS${i}`, crNumber: `CHG90${String(i).padStart(2, "0")}`, details: `d${i}` });
  }
  const grow = {
    keyIncidents: [],
    changesImplemented: many,
    changesPlanned: [{ date: 46259, systemArea: "P", crNumber: "CHGPLAN1", details: "planned" }],
    changesFailed: [{ date: 46252, systemArea: "F", crNumber: "CHGFAIL1", details: "failed" }],
    narrative: {}
  };
  // Fresh copy of the fixture sheet.
  const gf = fflate.unzipSync(new Uint8Array(sdFixture));
  const gsst = T.parseSharedStrings(gf);
  const wrote = T.patchSummaryDetailsSheet(gf, gsst, grow);
  const gx = decode(gf, "xl/worksheets/sheet2.xml");
  check("growth: reported all implemented + planned + failed rows written", wrote === 9 + 1 + 1, "wrote " + wrote);
  // All 9 implemented CRs present (last one previously would have been dropped).
  check("growth: first implemented CHG9001 present", /CHG9001<\/t>/.test(gx));
  check("growth: 6th implemented CHG9006 present (last old slot)", /CHG9006<\/t>/.test(gx));
  check("growth: 9th implemented CHG9009 present (needed new rows)", /CHG9009<\/t>/.test(gx));
  // Planned header text still intact and now on a shifted row (25 -> 28).
  check("growth: Changes Planned header preserved", /Changes Planned/.test(gx));
  check("growth: planned CR still written after shift", /CHGPLAN1<\/t>/.test(gx));
  check("growth: failed CR still written after shift", /CHGFAIL1<\/t>/.test(gx));
  check("growth: implemented header row 17 untouched", /Changes implemented this week/.test(gx));
  // No duplicate row numbers introduced by the shift.
  const rowNums = [...gx.matchAll(/<row\s[^>]*\br="(\d+)"/g)].map((m) => +m[1]);
  const uniq = new Set(rowNums);
  check("growth: no duplicate row numbers after insertion", uniq.size === rowNums.length,
    `rows=${rowNums.length} uniq=${uniq.size}`);
  check("growth: row numbers strictly increasing", rowNums.every((v, i) => i === 0 || v > rowNums[i - 1]), rowNums.join(","));
}

// --- Clearing leftover template sample rows ---
// Templates often ship with sample rows pre-filled under a section header. When
// the current pull has fewer rows, the extra template rows must be BLANKED, not
// left showing stale data. Build a sheet where the implemented section (hdr 3,
// data 5..8) is pre-seeded with 4 sample CRs and the planned section (hdr 10)
// with 2; feed 1 implemented + 0 planned and assert the rest are cleared.
console.log("\n== summary-details clears leftover template rows ==");
{
  const clSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:H20"/>
<sheetData>
<row r="3"><c r="A3" t="inlineStr"><is><t>Changes implemented this week</t></is></c></row>
<row r="4"><c r="A4" t="inlineStr"><is><t>Implementation Date</t></is></c><c r="C4" t="inlineStr"><is><t>CR Number</t></is></c></row>
<row r="5"><c r="A5"><v>46250</v></c><c r="C5" t="inlineStr"><is><t>SAMPLE_IMP_1</t></is></c></row>
<row r="6"><c r="A6"><v>46251</v></c><c r="C6" t="inlineStr"><is><t>SAMPLE_IMP_2</t></is></c></row>
<row r="7"><c r="A7"><v>46252</v></c><c r="C7" t="inlineStr"><is><t>SAMPLE_IMP_3</t></is></c></row>
<row r="8"><c r="A8"><v>46253</v></c><c r="C8" t="inlineStr"><is><t>SAMPLE_IMP_4</t></is></c></row>
<row r="10"><c r="A10" t="inlineStr"><is><t>Changes Planned</t></is></c></row>
<row r="11"><c r="A11" t="inlineStr"><is><t>Implementation Date</t></is></c><c r="C11" t="inlineStr"><is><t>CR Number</t></is></c></row>
<row r="12"><c r="A12"><v>46260</v></c><c r="C12" t="inlineStr"><is><t>SAMPLE_PLN_1</t></is></c></row>
<row r="13"><c r="A13"><v>46261</v></c><c r="C13" t="inlineStr"><is><t>SAMPLE_PLN_2</t></is></c></row>
<row r="15"><c r="A15" t="inlineStr"><is><t>Changes Failed this week</t></is></c></row>
<row r="16"><c r="A16" t="inlineStr"><is><t>Implementation Date</t></is></c><c r="C16" t="inlineStr"><is><t>CR Number</t></is></c></row>
<row r="17"><c r="A17" t="inlineStr"><is><t>Operational Health</t></is></c></row>
</sheetData></worksheet>`;
  const clFixture = fflate.zipSync({
    "[Content_Types].xml": enc(sumCt),
    "_rels/.rels": enc(rootRels),
    "xl/workbook.xml": enc(sdWb),
    "xl/_rels/workbook.xml.rels": enc(sumWbRels),
    "xl/sharedStrings.xml": enc(sst),
    "xl/worksheets/sheet1.xml": enc(sheet),
    "xl/worksheets/sheet2.xml": enc(clSheet)
  }, { level: 0 });
  const cf = fflate.unzipSync(new Uint8Array(clFixture));
  const csst = T.parseSharedStrings(cf);
  T.patchSummaryDetailsSheet(cf, csst, {
    keyIncidents: [],
    changesImplemented: [{ date: 46299, systemArea: "S", crNumber: "REAL_IMP", details: "d" }],
    changesPlanned: [],
    changesFailed: [],
    narrative: {}
  });
  const cx = decode(cf, "xl/worksheets/sheet2.xml");
  check("clear: real implemented CR written", /REAL_IMP</.test(cx));
  check("clear: leftover implemented sample 2 removed", !/SAMPLE_IMP_2</.test(cx));
  check("clear: leftover implemented sample 4 removed", !/SAMPLE_IMP_4</.test(cx));
  check("clear: leftover planned sample 1 removed (empty section)", !/SAMPLE_PLN_1</.test(cx));
  check("clear: leftover planned sample 2 removed (empty section)", !/SAMPLE_PLN_2</.test(cx));
  check("clear: implemented header preserved", /Changes implemented this week/.test(cx));
  check("clear: planned header preserved", /Changes Planned/.test(cx));
  check("clear: implemented column-header row preserved", /Implementation Date/.test(cx));
}

// --- mergeCells shift down when a section grows ---
// Mirrors the real template: the "Changes Failed" section has almost no blank
// data rows before an "Operational Health" block whose narrative rows are
// merged (A..D). Growing Failed must shift those merge ranges down, or they end
// up covering the Failed table and one cell renders merged across columns.
console.log("\n== summary-details mergeCells shift on growth ==");
{
  const mgSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:H20"/>
<sheetData>
<row r="3"><c r="A3" t="inlineStr"><is><t>Changes Failed this week</t></is></c></row>
<row r="4"><c r="A4" t="inlineStr"><is><t>Implementation Date</t></is></c><c r="C4" t="inlineStr"><is><t>CR Number</t></is></c></row>
<row r="5"><c r="A5" t="inlineStr"><is><t>None</t></is></c></row>
<row r="6"><c r="A6" t="inlineStr"><is><t>Operational Health</t></is></c></row>
<row r="7"><c r="A7" t="inlineStr"><is><t>No impact.</t></is></c></row>
</sheetData>
<mergeCells count="3"><mergeCell ref="A3:D3"/><mergeCell ref="A6:D6"/><mergeCell ref="A7:D12"/></mergeCells>
</worksheet>`;
  const mgFixture = fflate.zipSync({
    "[Content_Types].xml": enc(sumCt),
    "_rels/.rels": enc(rootRels),
    "xl/workbook.xml": enc(sdWb),
    "xl/_rels/workbook.xml.rels": enc(sumWbRels),
    "xl/sharedStrings.xml": enc(sst),
    "xl/worksheets/sheet1.xml": enc(sheet),
    "xl/worksheets/sheet2.xml": enc(mgSheet)
  }, { level: 0 });
  const mf = fflate.unzipSync(new Uint8Array(mgFixture));
  const msst = T.parseSharedStrings(mf);
  // 3 failed rows into a 1-row span (rows 5..5) -> insert 2 before row 6.
  T.patchSummaryDetailsSheet(mf, msst, {
    keyIncidents: [], changesImplemented: [], changesPlanned: [],
    changesFailed: [
      { date: 46251, systemArea: "F1", crNumber: "MCHGF1", details: "a" },
      { date: 46252, systemArea: "F2", crNumber: "MCHGF2", details: "b" },
      { date: 46253, systemArea: "F3", crNumber: "MCHGF3", details: "c" }
    ], narrative: {}
  });
  const mx = decode(mf, "xl/worksheets/sheet2.xml");
  const mergeRefs = [...mx.matchAll(/<mergeCell ref="([A-Z]+\d+:[A-Z]+\d+)"/g)].map((m) => m[1]);
  check("merge: header A3:D3 unchanged (above insertion)", mergeRefs.includes("A3:D3"));
  check("merge: op-health A6:D6 shifted to A8:D8", mergeRefs.includes("A8:D8"), mergeRefs.join(","));
  check("merge: narrative A7:D12 shifted to A9:D14", mergeRefs.includes("A9:D14"), mergeRefs.join(","));
  check("merge: old A6:D6 no longer present", !mergeRefs.includes("A6:D6"));
  check("merge: all 3 failed CRs written", /MCHGF1/.test(mx) && /MCHGF2/.test(mx) && /MCHGF3/.test(mx));
}

console.log(`\ntemplate-export: ${failed ? failed + " FAILED" : "all passed"}`);
process.exit(failed ? 1 : 0);

#!/usr/bin/env node
import {
  ExportService, MAP_MAX_COL, DEFAULT_EXPORT_MAP,
  expStr, tsvCell, sanitizeFilePart, b64FromBuffer, bufferFromB64
} from "../services/export-service.ts";
import { buildReport } from "../core/report.ts";

let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
}

const identity = (v) => (v ? String(v) : "");

const mkRow = (over = {}) => ({
  number: "INC001",
  priority: 2,
  state: "Resolved",
  createdOn: "2026-01-05T08:00:00Z",
  assignTimeUtcIso: "2026-01-05T09:00:00Z",
  acknTimeUtcIso: "2026-01-05T09:30:00Z",
  suspendTimeUtcIso: "",
  resumeTimeUtcIso: "",
  resolvedAt: "2026-01-05T17:00:00Z",
  ...over
});

const svc = new ExportService(identity);

console.log("== ExportService — template column map ==");

check("40 template columns", svc.tplColumns.length, 40);
check("col 1 is 1-based row number", svc.tplColumns[0].get(mkRow(), 0), "1");
check("col 5 is the raw ticket number", svc.tplColumns[4].get(mkRow(), 0), "INC001");
check("col 18 stays blank", svc.tplColumns[17].get(mkRow(), 0), "");
check("col 26 maps the report incident hours field", svc.tplColumns[25].get(mkRow(), 0), buildReport(mkRow(), identity).incidentHours);
check("MAP_MAX_COL matches the last template column", MAP_MAX_COL, svc.tplColumns.length);

console.log("== ExportService — field groups for the map dialog ==");

check("four groups, in order", svc.exportGroups.map((g) => g.name), ["General", "Ticket fields", "Report / SLA fields", "Durations"]);
check("fieldById resolves a report field label", svc.fieldById.get("rep:opCo")?.label, "Report: Op co");
check("fieldById getter for #row", svc.fieldById.get("#row")?.get(mkRow(), 2), "3");
check("DEFAULT_EXPORT_MAP anchors", { a: DEFAULT_EXPORT_MAP["#row"], z: DEFAULT_EXPORT_MAP["rep:analysedDate"] }, { a: "A", z: "AN" });

const durRow = mkRow({
  assignTimeUtcIso: "2026-01-05T09:00:00.000Z",
  acknTimeUtcIso: "2026-01-05T09:30:00.000Z",
  suspendTimeUtcIso: "2026-01-05T10:00:00.000Z",
  resumeTimeUtcIso: "2026-01-05T11:15:00.000Z",
  resolvedAtRaw: "2026-01-05 17:00:00"
});
check("dur fields resolve through the map dialog groups", [
  svc.fieldById.get("dur:assignToAckn")?.get(durRow, 0),
  svc.fieldById.get("dur:assignToResolve")?.get(durRow, 0),
  svc.fieldById.get("dur:suspendTotal")?.get(durRow, 0)
], ["0:30:00", "8:00:00", "1:15:00"]);
check("dur fields are not part of the default export map (byte-identical defaults)", ["dur:assignToAckn", "dur:assignToResolve", "dur:suspendTotal"].every((k) => !(k in DEFAULT_EXPORT_MAP)), true);

console.log("== ExportService — column map pre-processing ==");

check("no map falls back to the default 40 columns", svc.tplColumnsFromMap(null).length, 40);
const custom = svc.tplColumnsFromMap({ "#row": "B", "rep:opCo": "C" });
check("custom map keeps full column width", custom.length, 40);
check("custom map remaps #row to column B", custom[1].get(mkRow(), 0), "1");
check("custom map remaps rep:opCo to column C", typeof custom[2].get(mkRow(), 0), "string");
const junk = svc.tplColumnsFromMap({ "nope": "A", "rep:opCo": "ZZ" });
check("unknown fields and out-of-range letters are skipped", junk.length, 40);

console.log("== ExportService — MSR clipboard TSV ==");

const rowA = mkRow({ shortDescription: "alpha\nbeta\ttab" });
const rowB = mkRow({ number: "INC002" });
const tsv = svc.buildMsrTsv([rowA, rowB]);
const lines = tsv.split("\n");
check("one line per row", lines.length, 2);
check("21 cells per row", lines[0].split("\t").length, 21);
check("column A is the row index", [lines[0].split("\t")[0], lines[1].split("\t")[0]], ["1", "2"]);
check("column E carries the number", lines[1].split("\t")[4], "INC002");
check("newlines and tabs inside a cell are collapsed to spaces", lines[0].split("\t")[7], "alpha beta tab");

// Column D (msrType) labels: PRB -> P_Ticket, SCTASK -> RFS, REQ -> RFS.
check("column D for a PRB row is P_Ticket", svc.buildMsrTsv([mkRow({ number: "PRB0001234" })]).split("\t")[3], "P_Ticket");
check("column D for a SCTASK row is RFS", svc.buildMsrTsv([mkRow({ number: "SCTASK0001234" })]).split("\t")[3], "RFS");
check("column D for a REQ row is RFS", svc.buildMsrTsv([mkRow({ number: "REQ0001234" })]).split("\t")[3], "RFS");
check("column D for an INC row is Incident", svc.buildMsrTsv([mkRow({ number: "INC0001234" })]).split("\t")[3], "Incident");

// Column N serializes resolvedAt (a display string) directly. It must NOT be
// routed through the instant formatter, which would misparse a dd-MM-yyyy
// display string as MM-DD and produce a serial ~205 days off. Column K
// serializes createdOn the same way.
const pad = (n) => String(n).padStart(2, "0");
const gridFmt = (utcIso) => {
  if (!utcIso) return "";
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return String(utcIso);
  return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const svcGrid = new ExportService(gridFmt);
const dispRow = mkRow({
  createdOn: "01-08-2026 10:00:00",
  assignTimeUtcIso: "2026-08-01T10:05:00.000Z",
  acknTimeUtcIso: "2026-08-01T10:30:00.000Z",
  suspendTimeUtcIso: "",
  resumeTimeUtcIso: "",
  resolvedAt: "01-08-2026 15:00:00"
});
const dispCells = svcGrid.buildMsrTsv([dispRow]).split("\n")[0].split("\t");
check("column K serial is createdOn 1 Aug 2026 10:00 (not the ~205-day-off value)", dispCells[10], "46235.4166666667");
check("column N serial is resolvedAt 1 Aug 2026 15:00 (not the ~205-day-off value)", dispCells[13], "46235.625");
check("column K is not the misparsed serial", dispCells[10] !== "46030.4166666667", true);
check("column N is not the misparsed serial", dispCells[13] !== "46030.625", true);

console.log("== ExportService — per-CI-group split ==");

const groupDefs = [
  { name: "Support", items: ["sup"] },
  { name: "DevOps", items: ["dev"] }
];
const splitRows = [
  mkRow({ configItem: "SuperApp" }),
  mkRow({ configItem: "DevPortal" }),
  mkRow({ configItem: "dev" }),
  mkRow({ configItem: "Other" }),
  mkRow({ configItem: "SUPERAPP" }),
  mkRow({ configItem: "" })
];
const groups = svc.buildCiGroups(splitRows, groupDefs);
check("group order follows config, Others appended last", groups.map((g) => g.name), ["Support", "DevOps", "Others"]);
check("prefix matching is case-insensitive", groups[0].rows.length, 2);
check("DevOps catches exact and prefixed items", groups[1].rows.length, 2);
check("unmatched rows land in Others", groups[2].rows.length, 2);
check("empty Others bucket is omitted", svc.buildCiGroups([mkRow({ configItem: "Dev" })], groupDefs).map((g) => g.name), ["DevOps"]);

const ties = svc.buildCiGroups([mkRow({ configItem: "xyz-core" })], [
  { name: "A", items: ["xyz"] },
  { name: "B", items: ["xyz"] }
]);
check("equal-length match resolves to the earlier group", ties[0].name, "A");

const diag = svc.ciSplitDiagnostics(groups, splitRows, groupDefs);
check("split diagnostics totals", { t: diag.total, o: diag.others, e: diag.emptyGroups }, { t: 6, o: 2, e: [] });
const diag2 = svc.ciSplitDiagnostics(groups, splitRows, [...groupDefs, { name: "Empty", items: ["emptiness"] }]);
check("empty configured groups are reported", diag2.emptyGroups, ["Empty"]);

console.log("== ExportService — filled filename and cell helpers ==");

const fn = svc.filledFilename("report.xlsx");
check("filled filename carries the template base and a timestamp", /^report_filled_\d{8}-\d{4}\.xlsx$/.test(fn), true);
check("group label is sanitized into the filename", svc.filledFilename("report.xlsx", "CI/CD Group!").includes("_CI-CD-Group_filled_"), true);
check("expStr null/undefined become empty", [expStr(null), expStr(undefined)], ["", ""]);
check("tsvCell collapses whitespace controls", tsvCell("a\tb\r\nc "), "a b c");
check("sanitizeFilePart strips edge dashes and falls back to 'group'", [sanitizeFilePart("/CI/CD/"), sanitizeFilePart("")], ["CI-CD", "group"]);
check("cellValue rep: branch uses the report", svc.cellValue(mkRow(), "rep:incCurrentHours", ""), "8:00:00");
check("cellValue inst branch formats a value", svc.cellValue(mkRow({ assignTimeUtcIso: "2026-01-05T09:00:00Z" }), "assignTimeUtcIso", "inst"), "2026-01-05T09:00:00Z");

console.log("== ExportService — base64 helpers ==");

check("bufferFromB64 decodes", new TextDecoder().decode(bufferFromB64("SGVsbG8=")), "Hello");
const buf = new Uint8Array([1, 2, 3, 254, 255]).buffer;
check("b64FromBuffer round-trips", new Uint8Array(bufferFromB64(b64FromBuffer(buf))).join(","), "1,2,3,254,255");

process.exit(failed ? 1 : 0);
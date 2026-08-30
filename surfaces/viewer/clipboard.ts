import * as MsrChoices from "../../core/msrchoices.ts";
import { buildRep } from "./core.ts";
import type { ViewerRow } from "./core.ts";
import { expStr } from "./exporter.ts";
import { fmtInstant } from "./grid.ts";


const msrWallSerial = (wall: unknown): string => {
  const s = MsrChoices.displayToSerial(wall);
  return s === null ? "" : String(s);
};
const msrInstSerial = (row: ViewerRow, key: string): string => row[key] ? msrWallSerial(fmtInstant(row[key], row)) : "";
const msrDispSerial = (v: unknown): string => v ? msrWallSerial(String(v)) : "";

type MsrCol = { letter: string; get: (r: ViewerRow, i: number) => unknown };

const MSR_COLUMNS: MsrCol[] = [
  { letter: "A", get: (r, i) => i + 1 },
  { letter: "B", get: r => buildRep(r, fmtInstant).opCo },
  { letter: "C", get: r => buildRep(r, fmtInstant).domain },
  { letter: "D", get: r => MsrChoices.msrType(r.number) },
  { letter: "E", get: r => expStr(r.number) },
  { letter: "F", get: r => expStr(r.assignmentGroup) },
  { letter: "G", get: r => { const m = String(r.priority ?? "").match(/\d+/); return m ? m[0] : expStr(r.priority); } },
  { letter: "H", get: r => expStr(r.shortDescription) },
  { letter: "I", get: r => MsrChoices.msrStatus(expStr(r.state)) },
  { letter: "J", get: r => expStr(r.assignedTo) },
  { letter: "K", get: r => msrDispSerial(r.createdOn) },
  { letter: "L", get: r => msrInstSerial(r, "assignTimeUtcIso") },
  { letter: "M", get: r => msrInstSerial(r, "acknTimeUtcIso") },
  { letter: "N", get: r => msrInstSerial(r, "createdOn") },
  { letter: "O", get: r => msrInstSerial(r, "suspendTimeUtcIso") },
  { letter: "P", get: r => msrInstSerial(r, "resumeTimeUtcIso") },
  { letter: "Q", get: r => expStr(r.configItem) },
  { letter: "R", get: r => MsrChoices.normResolution(expStr(r.solutionType)) },
  { letter: "S", get: r => expStr(r.rootCause) },
  { letter: "T", get: r => expStr(r.subCategory) },
  { letter: "U", get: r => expStr(r.duplicateIncident) }
];

function tsvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return s.replace(/\s*[\r\n]+\s*/g, " ").replace(/[\t\v\f]+/g, " ").trim();
}

function buildMsrTsv(rows: ViewerRow[]): string {
  return rows.map((row, i) =>
    MSR_COLUMNS.map(c => tsvCell(c.get(row, i))).join("\t")
  ).join("\n");
}


function cellValue(row: ViewerRow, key: string, cls: string): string {
  if (key.startsWith("rep:")) {
    return String(buildRep(row, fmtInstant)[key.slice(4)] ?? "");
  }
  let v = row[key];
  if (cls === "inst") v = fmtInstant(v, row);
  return v === null || v === undefined ? "" : String(v);
}

export {
  tsvCell,
  buildMsrTsv,
  cellValue,
  msrWallSerial,
  msrInstSerial,
  msrDispSerial,
  MSR_COLUMNS
};
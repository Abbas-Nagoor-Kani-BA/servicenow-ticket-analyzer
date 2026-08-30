import { buildRep } from "./core.ts";
import type { ViewerRow } from "./core.ts";
import { fmtInstant } from "./grid.ts";

const TPL_SHEET_NAME = "all_ticket_details";

export type TplCol = { col: number; get: (r: ViewerRow, i: number) => unknown };

const TPL_COLUMNS: TplCol[] = [
  { col: 1, get: (r, i) => String(i + 1) },
  { col: 2, get: r => buildRep(r, fmtInstant).opCo },
  { col: 3, get: r => buildRep(r, fmtInstant).domain },
  { col: 4, get: r => buildRep(r, fmtInstant).type },
  { col: 5, get: r => r.number },
  { col: 6, get: r => r.assignmentGroup },
  { col: 7, get: r => r.priority },
  { col: 8, get: r => r.shortDescription },
  { col: 9, get: r => r.state },
  { col: 10, get: r => r.assignedTo },
  { col: 11, get: r => buildRep(r, fmtInstant).created },
  { col: 12, get: r => buildRep(r, fmtInstant).assigned },
  { col: 13, get: r => buildRep(r, fmtInstant).ackn },
  { col: 14, get: r => buildRep(r, fmtInstant).resolved },
  { col: 15, get: r => buildRep(r, fmtInstant).susp },
  { col: 16, get: r => buildRep(r, fmtInstant).resumed },
  { col: 17, get: r => buildRep(r, fmtInstant).impactedApplication },
  { col: 18, get: () => "" },
  { col: 19, get: r => buildRep(r, fmtInstant).rootCauseCategory },
  { col: 20, get: r => buildRep(r, fmtInstant).resolutionType },
  { col: 21, get: () => "" },
  { col: 22, get: () => "" },
  { col: 23, get: () => "" },
  { col: 24, get: () => "" },
  { col: 25, get: () => "" },
  { col: 26, get: r => buildRep(r, fmtInstant).incidentHours },
  { col: 27, get: r => buildRep(r, fmtInstant).incidentTotalAge },
  { col: 28, get: r => buildRep(r, fmtInstant).incCurrentHours },
  { col: 29, get: r => buildRep(r, fmtInstant).incidentCurrentAge },
  { col: 30, get: r => buildRep(r, fmtInstant).responseSLA },
  { col: 31, get: r => buildRep(r, fmtInstant).cumulativeSla },
  { col: 32, get: r => buildRep(r, fmtInstant).cumulativeDays },
  { col: 33, get: r => buildRep(r, fmtInstant).timeTaken },
  { col: 34, get: r => buildRep(r, fmtInstant).metResponseSLA },
  { col: 35, get: r => buildRep(r, fmtInstant).metMinResolutionSLA },
  { col: 36, get: r => buildRep(r, fmtInstant).metMaxResolutionSLA },
  { col: 37, get: () => "" },
  { col: 38, get: () => "" },
  { col: 39, get: () => "" },
  { col: 40, get: r => buildRep(r, fmtInstant).analysedDate }
];

function expStr(v: unknown): string { return v === null || v === undefined ? "" : String(v); }
function expRaw(key: string) { return (r: ViewerRow): string => expStr(r[key]); }
function expRep(key: string) { return (r: ViewerRow): unknown => buildRep(r, fmtInstant)[key] ?? ""; }

export type ExportFieldGet = (r: ViewerRow, i: number) => unknown;
export type ExportGroup = { name: string; items: Array<[string, string, ExportFieldGet]> };

const EXPORT_GROUPS: ExportGroup[] = [
  {
    name: "General",
    items: [["#row", "Row number", (r, i) => String(i + 1)]]
  },
  {
    name: "Ticket fields",
    items: [
      ["number", "Number", expRaw("number")],
      ["shortDescription", "Short description", expRaw("shortDescription")],
      ["state", "State", expRaw("state")],
      ["priority", "Priority", expRaw("priority")],
      ["assignmentGroup", "Group", expRaw("assignmentGroup")],
      ["assignedTo", "Assigned to", expRaw("assignedTo")]
    ]
  },
  {
    name: "Report / SLA fields",
    items: [
      ["rep:type", "Report: Type", expRep("type")],
      ["rep:opCo", "Report: Op co", expRep("opCo")],
      ["rep:domain", "Report: Domain", expRep("domain")],
      ["rep:created", "Report: Created", expRep("created")],
      ["rep:assigned", "Report: Assigned", expRep("assigned")],
      ["rep:ackn", "Report: Acknowledged", expRep("ackn")],
      ["rep:resolved", "Report: Resolved", expRep("resolved")],
      ["rep:susp", "Report: Suspended", expRep("susp")],
      ["rep:resumed", "Report: Resumed", expRep("resumed")],
      ["rep:impactedApplication", "Report: Impacted application", expRep("impactedApplication")],
      ["rep:resolutionType", "Report: Resolution type", expRep("resolutionType")],
      ["rep:rootCauseCategory", "Report: Root cause", expRep("rootCauseCategory")],
      ["rep:incidentHours", "Report: Incident hours", expRep("incidentHours")],
      ["rep:incidentTotalAge", "Report: Incident total age", expRep("incidentTotalAge")],
      ["rep:incCurrentHours", "Report: Inc current hours (from ASG)", expRep("incCurrentHours")],
      ["rep:incidentCurrentAge", "Report: Incident current age", expRep("incidentCurrentAge")],
      ["rep:responseSLA", "Report: Response SLA", expRep("responseSLA")],
      ["rep:cumulativeSla", "Report: Cumulative SLA (= Inc current hours)", expRep("cumulativeSla")],
      ["rep:cumulativeDays", "Report: Cumulative days (= Incident current age)", expRep("cumulativeDays")],
      ["rep:timeTaken", "Report: Time taken (= Incident current age)", expRep("timeTaken")],
      ["rep:metResponseSLA", "Report: Met response SLA", expRep("metResponseSLA")],
      ["rep:metMinResolutionSLA", "Report: Met min resolution SLA", expRep("metMinResolutionSLA")],
      ["rep:metMaxResolutionSLA", "Report: Met max resolution SLA", expRep("metMaxResolutionSLA")],
      ["rep:analysedDate", "Report: Analysed date", expRep("analysedDate")]
    ]
  }
];

export const EXPORT_FIELD_BY_ID: Map<string, { id: string; label: string; get: ExportFieldGet }> = new Map();
for (const g of EXPORT_GROUPS) {
  for (const [id, label, get] of g.items) EXPORT_FIELD_BY_ID.set(id, { id, label, get });
}

// Mirrors the hardcoded TPL_COLUMNS layout; AK-AM stay blank like T-Y.
const DEFAULT_EXPORT_MAP: Record<string, string> = {
  "#row": "A",
  "rep:opCo": "B", "rep:domain": "C", "rep:type": "D",
  "number": "E", "assignmentGroup": "F", "priority": "G", "shortDescription": "H",
  "state": "I", "assignedTo": "J", "rep:created": "K", "rep:assigned": "L",
  "rep:ackn": "M", "rep:resolved": "N", "rep:susp": "O", "rep:resumed": "P",
  "rep:impactedApplication": "Q", "rep:rootCauseCategory": "S", "rep:resolutionType": "T",
  "rep:incidentHours": "Z", "rep:incidentTotalAge": "AA", "rep:incCurrentHours": "AB",
  "rep:incidentCurrentAge": "AC", "rep:responseSLA": "AD", "rep:cumulativeSla": "AE",
  "rep:cumulativeDays": "AF", "rep:timeTaken": "AG", "rep:metResponseSLA": "AH",
  "rep:metMinResolutionSLA": "AI", "rep:metMaxResolutionSLA": "AJ", "rep:analysedDate": "AN"
};

const MAP_MAX_COL = 40;

export {
  expStr,
  expRaw,
  expRep,
  TPL_SHEET_NAME,
  TPL_COLUMNS,
  EXPORT_GROUPS,
  DEFAULT_EXPORT_MAP,
  MAP_MAX_COL
};
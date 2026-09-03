import * as MsrChoices from "../core/msrchoices.ts";
import { letterToColNum } from "../lib/markup.ts";
import { pad2 } from "../lib/format.ts";
import { computeDurations, type Durations } from "../core/durations.ts";
import { ReportService, type ReportFmt } from "./report-service.ts";

/*
 * Export-BUILDING work for the viewer: the template column map, the field
 * groups for the map dialog, the MSR clipboard layout, per-CI-group splitting
 * and TSV assembly, template/column-map pre-processing, and the filled
 * filename. Pure computation only — no DOM, no chrome.*, no downloads.
 *
 * The download itself (Blob + chrome.downloads) stays in the outputting
 * surface; never move byte-building into the background. This class is bound
 * to the viewer's instinct-clock formatter so the exported dates and the
 * template fill match exactly what the grid shows.
 */

export type Row = Record<string, any>;
export type ColGet = (r: Row, i: number) => unknown;
export type TplCol = { col: number; get: ColGet };
export type ExportFieldGet = ColGet;
export type ExportFieldDef = { id: string; label: string; get: ExportFieldGet };
export type ExportGroup = { name: string; items: Array<[string, string, ExportFieldGet]> };
export type MsrCol = { letter: string; get: ColGet };
export type CiGroupDef = { name: string; items: string[] };
export type CiGroupRows = { name: string; rows: Row[] };

export const TPL_SHEET_NAME = "all_ticket_details";

// Mirrors the hardcoded TPL_COLUMNS layout; AK-AM stay blank like T-Y.
export const DEFAULT_EXPORT_MAP: Record<string, string> = {
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

export const MAP_MAX_COL = 40;

export function expStr(v: unknown): string {
  return v === null || v === undefined ? "" : String(v);
}

export function tsvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return s.replace(/\s*[\r\n]+\s*/g, " ").replace(/[\t\v\f]+/g, " ").trim();
}

export function sanitizeFilePart(s: unknown): string {
  return String(s).replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "group";
}

export function b64FromBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  }
  return btoa(bin);
}

export function bufferFromB64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export class ExportService {
  readonly tplColumns: TplCol[];
  readonly exportGroups: ExportGroup[];
  readonly fieldById: ReadonlyMap<string, ExportFieldDef>;
  readonly msrColumns: MsrCol[];
  protected readonly rep: ReportService;
  protected readonly fmt: ReportFmt;

  constructor(fmt: ReportFmt) {
    this.fmt = fmt;
    this.rep = new ReportService();

    const expRaw = (key: string): ColGet => (r: Row) => expStr(r[key]);
    const expRep = (key: string): ColGet => (r: Row) => this.rep.rep(r, this.fmt)[key] ?? "";
    const durGet = (key: keyof Durations): ColGet => (r: Row) => computeDurations(r)[key];

    this.tplColumns = [
      { col: 1, get: (r, i) => String(i + 1) },
      { col: 2, get: r => this.rep.rep(r, this.fmt).opCo },
      { col: 3, get: r => this.rep.rep(r, this.fmt).domain },
      { col: 4, get: r => this.rep.rep(r, this.fmt).type },
      { col: 5, get: r => r.number },
      { col: 6, get: r => r.assignmentGroup },
      { col: 7, get: r => r.priority },
      { col: 8, get: r => r.shortDescription },
      { col: 9, get: r => r.state },
      { col: 10, get: r => r.assignedTo },
      { col: 11, get: r => this.rep.rep(r, this.fmt).created },
      { col: 12, get: r => this.rep.rep(r, this.fmt).assigned },
      { col: 13, get: r => this.rep.rep(r, this.fmt).ackn },
      { col: 14, get: r => this.rep.rep(r, this.fmt).resolved },
      { col: 15, get: r => this.rep.rep(r, this.fmt).susp },
      { col: 16, get: r => this.rep.rep(r, this.fmt).resumed },
      { col: 17, get: r => this.rep.rep(r, this.fmt).impactedApplication },
      { col: 18, get: () => "" },
      { col: 19, get: r => this.rep.rep(r, this.fmt).rootCauseCategory },
      { col: 20, get: r => this.rep.rep(r, this.fmt).resolutionType },
      { col: 21, get: () => "" },
      { col: 22, get: () => "" },
      { col: 23, get: () => "" },
      { col: 24, get: () => "" },
      { col: 25, get: () => "" },
      { col: 26, get: r => this.rep.rep(r, this.fmt).incidentHours },
      { col: 27, get: r => this.rep.rep(r, this.fmt).incidentTotalAge },
      { col: 28, get: r => this.rep.rep(r, this.fmt).incCurrentHours },
      { col: 29, get: r => this.rep.rep(r, this.fmt).incidentCurrentAge },
      { col: 30, get: r => this.rep.rep(r, this.fmt).responseSLA },
      { col: 31, get: r => this.rep.rep(r, this.fmt).cumulativeSla },
      { col: 32, get: r => this.rep.rep(r, this.fmt).cumulativeDays },
      { col: 33, get: r => this.rep.rep(r, this.fmt).timeTaken },
      { col: 34, get: r => this.rep.rep(r, this.fmt).metResponseSLA },
      { col: 35, get: r => this.rep.rep(r, this.fmt).metMinResolutionSLA },
      { col: 36, get: r => this.rep.rep(r, this.fmt).metMaxResolutionSLA },
      { col: 37, get: () => "" },
      { col: 38, get: () => "" },
      { col: 39, get: () => "" },
      { col: 40, get: r => this.rep.rep(r, this.fmt).analysedDate }
    ];

    this.exportGroups = [
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
      },
      {
        name: "Durations",
        items: [
          ["dur:assignToAckn", "Time to acknowledge", durGet("assignToAckn")],
          ["dur:assignToResolve", "Time to resolve", durGet("assignToResolve")],
          ["dur:suspendTotal", "Suspend total", durGet("suspendTotal")]
        ]
      }
    ];

    const defs: ExportFieldDef[] = [];
    for (const g of this.exportGroups) {
      for (const [id, label, get] of g.items) defs.push({ id, label, get });
    }
    this.fieldById = new Map(defs.map(d => [d.id, d]));

    const msrWallSerial = (wall: unknown): string => {
      const s = MsrChoices.displayToSerial(wall);
      return s === null ? "" : String(s);
    };
    const msrInstSerial = (row: Row, key: string): string => row[key] ? msrWallSerial(this.fmt(String(row[key]), row)) : "";
    const msrDispSerial = (v: unknown): string => v ? msrWallSerial(String(v)) : "";

    this.msrColumns = [
      { letter: "A", get: (r, i) => i + 1 },
      { letter: "B", get: r => this.rep.rep(r, this.fmt).opCo },
      { letter: "C", get: r => this.rep.rep(r, this.fmt).domain },
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
      { letter: "N", get: r => msrDispSerial(r.resolvedAt) },
      { letter: "O", get: r => msrInstSerial(r, "suspendTimeUtcIso") },
      { letter: "P", get: r => msrInstSerial(r, "resumeTimeUtcIso") },
      { letter: "Q", get: r => expStr(r.configItem) },
      { letter: "R", get: r => MsrChoices.normResolution(expStr(r.solutionType)) },
      { letter: "S", get: r => expStr(r.rootCause) },
      { letter: "T", get: r => expStr(r.subCategory) },
      { letter: "U", get: r => expStr(r.duplicateIncident) }
    ];
  }

  buildMsrTsv(rows: Row[]): string {
    return rows.map((row, i) =>
      this.msrColumns.map(c => tsvCell(c.get(row, i))).join("\t")
    ).join("\n");
  }

  cellValue(row: Row, key: string, cls: string): string {
    if (key.startsWith("rep:")) {
      return String(this.rep.rep(row, this.fmt)[key.slice(4)] ?? "");
    }
    if (key.startsWith("dur:")) {
      return String(computeDurations(row)[key.slice(4) as keyof Durations] ?? "");
    }
    let v = row[key];
    if (cls === "inst") v = this.fmt(String(v), row);
    return v === null || v === undefined ? "" : String(v);
  }

  tplColumnsFromMap(map: unknown): TplCol[] {
    if (!map || typeof map !== "object") return this.tplColumns;
    const byCol = new Map<number, ColGet>();
    for (const [fid, letter] of Object.entries(map as Record<string, string>)) {
      const f = this.fieldById.get(fid);
      const col = letterToColNum(letter);
      if (!f || col < 1 || col > MAP_MAX_COL) continue;
      byCol.set(col, f.get);
    }
    if (!byCol.size) return this.tplColumns;
    const last = Math.max(MAP_MAX_COL, ...byCol.keys());
    const out: TplCol[] = [];
    for (let c = 1; c <= last; c++) {
      out.push({ col: c, get: byCol.get(c) || (() => "") });
    }
    return out;
  }

  buildCiGroups(rows: Row[], groupDefs: CiGroupDef[]): CiGroupRows[] {
    const norm = (s: unknown): string => String(s ?? "").trim().toLowerCase();
    const bounds: Array<{ key: string; name: string; gi: number }> = [];
    for (let gi = 0; gi < groupDefs.length; gi++) {
      const g = groupDefs[gi];
      for (const it of g.items) {
        const key = norm(it);
        if (key) bounds.push({ key, name: g.name, gi });
      }
    }
    const byGroup = new Map<string, Row[]>();
    const others: Row[] = [];
    for (const r of rows) {
      const k = norm(r.configItem);
      let best: { key: string; name: string; gi: number } | null = null;
      if (k) {
        for (const b of bounds) {
          if ((k.startsWith(b.key) || k.includes(b.key)) &&
            (!best || b.key.length > best.key.length || (b.key.length === best.key.length && b.gi < best.gi))) {
            best = b;
          }
        }
      }
      if (!best) {
        others.push(r);
      } else {
        if (!byGroup.has(best.name)) byGroup.set(best.name, []);
        byGroup.get(best.name)!.push(r);
      }
    }
    const out = groupDefs
      .filter(g => byGroup.has(g.name))
      .map(g => ({ name: g.name, rows: byGroup.get(g.name)! }));
    if (others.length) out.push({ name: "Others", rows: others });
    return out;
  }

  ciSplitDiagnostics(groups: CiGroupRows[], rows: Row[], groupDefs: CiGroupDef[]): { total: number; others: number; emptyGroups: string[] } {
    const names = new Set(groups.map(g => g.name));
    const others = groups.find(g => g.name === "Others");
    const emptyGroups = groupDefs
      .filter(g => g.items.length && !names.has(g.name))
      .map(g => g.name);
    return {
      total: rows.length,
      others: others ? others.rows.length : 0,
      emptyGroups
    };
  }

  filledFilename(templateName: string, groupLabel?: string): string {
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
    const base = templateName.replace(/\.xlsx$/i, "");
    const mid = groupLabel ? `_${sanitizeFilePart(groupLabel)}` : "";
    return `${base}${mid}_filled_${stamp}.xlsx`;
  }
}
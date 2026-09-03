import { xmlEscape, decodeText, encodeText, colLetter } from "../lib/markup.ts";

// ---------------------------------------------------------------------------
// OpenXML template surgery (ZIP / SpreadsheetML byte manipulation).
//
// This module patched the USER'S OWN formatted .xlsx template at the zip level.
// It is deliberately NOT re-serialized with a spreadsheet library (ExcelJS /
// SheetJS re-serialization corrupts formatted templates -> Excel "repair").
//
// Pipeline (fillTemplateBuffer):
//   1. fflate.unzipSync the template into a raw {path -> Uint8Array} map.
//   2. Resolve which sheet to patch: findTargetSheetPath reads xl/workbook.xml
//      + xl/_rels/workbook.xml.rels, matches the wanted sheet by normalized
//      name (case-insensitive, _/space interchangeable), exact then loose.
//      Returns null rather than ever falling back to a different sheet.
//   3. Parse xl/sharedStrings.xml because template text cells may be t="s".
//   4. Detect the header row: find the word "reference" in column E
//      (findHeaderRowInXml), resolving t="s" shared strings.
//   5. Harvest per-column styles (borders/number formats) from the template's
//      own first data rows (harvestDataCellStyles) so generated cells inherit s=.
//   6. Build new data rows as t="inlineStr" cells (buildDataRowsXml).
//   7. patchSheetXml: keep rows before the header verbatim, drop rows >=
//      header+1, emit generated rows, update <dimension>.
//   8. Optionally patchSummarySlaSheet (second, keyed surgical path).
//   9. stripCalcChain if formula rows were deleted (removes xl/calcChain.xml +
//      its Content_Types override + workbook rel, sets fullCalcOnLoad on
//      <calcPr>) — else Excel raises its repair dialog on stale chain refs.
//  10. fflate.zipSync to re-pack; every other zip entry stays byte-identical.
//
// See docs/invariants.md "Invariant 3" for the full constraint set.
// ---------------------------------------------------------------------------

type FileMap = Record<string, Uint8Array>;
type Fflate = {
  unzipSync: (data: Uint8Array) => FileMap;
  zipSync: (files: FileMap, opts?: { level?: number }) => Uint8Array;
};

let fflate: Fflate | null = globalThis?.fflate ?? null;
export function setFflate(f: Fflate | null): void { fflate = f; }

function normSheetName(s: string): string {
  return String(s).toLowerCase().replace(/[\s_]+/g, "");
}

function findTargetSheetPath(files: FileMap, wanted: string): string | null {
  const target = normSheetName(wanted);
  const wbXml = decodeText(files["xl/workbook.xml"] || new Uint8Array());
  const relsXml = decodeText(files["xl/_rels/workbook.xml.rels"] || new Uint8Array());
  const resolveRel = (rid: string): string | null => {
    const relMatch = relsXml.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]*)"`, "i"))
      || relsXml.match(new RegExp(`<Relationship[^>]*Target="([^"]*)"[^>]*Id="${rid}"`, "i"));
    if (!relMatch) return null;
    let t = relMatch[1].replace(/^\//, "");
    if (!t.startsWith("xl/")) t = "xl/" + t;
    return files[t] ? t : null;
  };
  for (const mode of ["exact", "loose"] as const) {
    const tagRe = /<sheet\b[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(wbXml)) !== null) {
      const nameM = m[0].match(/\bname="([^"]*)"/i);
      const ridM = m[0].match(/\br:id="([^"]*)"/i);
      if (!nameM || !ridM) continue;
      const norm = normSheetName(nameM[1]);
      if ((mode === "exact" ? norm === target : norm.includes(target))) {
        const p = resolveRel(ridM[1]);
        if (p) return p;
      }
    }
  }
  return null;
}

function parseSharedStrings(files: FileMap): string[] {
  const raw = files["xl/sharedStrings.xml"];
  if (!raw) return [];
  const xml = decodeText(raw);
  const items: string[] = [];
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (!m[1]) { items.push(""); continue; }
    let text = "";
    const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\/>/g;
    let t: RegExpExecArray | null;
    while ((t = tRe.exec(m[1])) !== null) text += t[1] ?? "";
    items.push(text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&"));
  }
  return items;
}

function cellDisplayValue(cellXml: string, sharedStrings: string[]): string {
  const isMatch = cellXml.match(/<is>([\s\S]*?)<\/is>/);
  if (isMatch) {
    let text = "";
    const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\/>/g;
    let t: RegExpExecArray | null;
    while ((t = tRe.exec(isMatch[1])) !== null) text += t[1] ?? "";
    return text;
  }
  const vMatch = cellXml.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
  if (!vMatch) return "";
  if (/t="s"/.test(cellXml)) {
    const idx = parseInt(vMatch[1], 10);
    return Number.isFinite(idx) ? (sharedStrings[idx] ?? "") : "";
  }
  return vMatch[1];
}

function harvestDataCellStyles(sheetXml: string, startRow: number): Record<string, string> {
  const openEnd = sheetXml.indexOf("</sheetData>");
  if (openEnd === -1) return {};
  const sdStart = sheetXml.lastIndexOf("<sheetData", openEnd);
  const innerStart = sheetXml.indexOf(">", sdStart) + 1;
  const inner = sheetXml.slice(innerStart, openEnd);
  const map: Record<string, string> = {};
  const rowRe = /<row\s[^>]*r="(\d+)"[\s\S]*?<\/row>/g;
  let m: RegExpExecArray | null;
  let scanned = 0;
  while ((m = rowRe.exec(inner)) !== null) {
    const rowNum = parseInt(m[1], 10);
    if (rowNum < startRow) continue;
    if (++scanned > 50) break;
    const cellRe = /<c\s[^>]*?\br="([A-Z]+)\d+"[^>]*?(?:\/>|>)/g;
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(m[0])) !== null) {
      const col = c[1];
      if (map[col] !== undefined) continue;
      const sM = c[0].match(/\bs="(\d+)"/);
      if (sM) map[col] = sM[1];
    }
  }
  return map;
}

function isNumericCellValue(s: string): boolean {
  const t = s.trim();
  if (!t || /^0\d/.test(t)) return false;
  return /^-?\d+(\.\d+)?$/.test(t);
}

export type TemplateCol = { col: number; get: (row: unknown, index: number) => unknown };

function buildDataRowsXml(
  rows: unknown[],
  startRow: number,
  styleMap: Record<string, string> | null,
  tplCols: TemplateCol[]
): string {
  let out = "";
  rows.forEach((row, i) => {
    let cells = "";
    for (const { col, get } of tplCols) {
      const letter = colLetter(col);
      const s = styleMap && styleMap[letter] !== undefined ? ` s="${styleMap[letter]}"` : "";
      const v = get(row, i);
      if (v === null || v === undefined || String(v) === "") {
        if (!s) continue;
        cells += `<c r="${letter}${startRow + i}"${s}/>`;
        continue;
      }
      const str = String(v);
      if (isNumericCellValue(str)) {
        cells += `<c r="${letter}${startRow + i}"${s}><v>${str.trim()}</v></c>`;
        continue;
      }
      cells += `<c r="${letter}${startRow + i}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(str)}</t></is></c>`;
    }
    out += `<row r="${startRow + i}">${cells}</row>`;
  });
  return out;
}

function patchSheetXml(sheetXml: string, sharedStrings: string[], dataRowsXml: string, startRow: number, lastDataRow: number, lastColLetter: string): string {
  const dimRe = /(<dimension ref=")([^"]*)(")/;
  if (dimRe.test(sheetXml)) {
    sheetXml = sheetXml.replace(dimRe, `$1A1:${lastColLetter}${lastDataRow}$3`);
  }
  const sdOpen = sheetXml.search(/<sheetData\s*\/>/);
  if (sdOpen !== -1) {
    return sheetXml.replace(/<sheetData\s*\/>/, `<sheetData>${dataRowsXml}</sheetData>`);
  }
  const openEnd = sheetXml.indexOf("</sheetData>");
  if (openEnd === -1) return sheetXml;
  const sdStart = sheetXml.lastIndexOf("<sheetData", openEnd);
  const innerStart = sheetXml.indexOf(">", sdStart) + 1;
  const inner = sheetXml.slice(innerStart, openEnd);
  const keptRows: string[] = [];
  const rowRe = /<row\s[^>]*r="(\d+)"[\s\S]*?<\/row>|<row\s[^>]*r="(\d+)"[^>]*\/>/g;
  let m: RegExpExecArray | null;
  let lastKeptEnd = 0;
  while ((m = rowRe.exec(inner)) !== null) {
    const rowNum = parseInt(m[1] || m[2], 10);
    if (rowNum < startRow && m.index >= lastKeptEnd) {
      keptRows.push(inner.slice(lastKeptEnd, m.index + m[0].length));
      lastKeptEnd = m.index + m[0].length;
    } else if (rowNum < startRow) {
      lastKeptEnd = m.index + m[0].length;
    } else {
      lastKeptEnd = Math.max(lastKeptEnd, m.index + m[0].length);
    }
  }
  if (keptRows.length === 0 && startRow > 1) {
    const firstRowMatch = inner.match(/<row\s[^>]*r="(\d+)"/);
    if (firstRowMatch) {
      const firstIdx = inner.indexOf(firstRowMatch[0]);
      keptRows.push(inner.slice(0, firstIdx));
    }
  } else if (lastKeptEnd < inner.length) {
    keptRows.push(inner.slice(lastKeptEnd));
  }
  const rebuilt = keptRows.join("") + dataRowsXml;
  return sheetXml.slice(0, innerStart) + rebuilt + sheetXml.slice(openEnd);
}

function findHeaderRowInXml(sheetXml: string, sharedStrings: string[]): number {
  const rowRe = /<row\s[^>]*r="(\d+)"[\s\S]*?<\/row>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(sheetXml)) !== null) {
    const rowNum = parseInt(m[1], 10);
    if (rowNum > 30) break;
    const eCell = m[0].match(new RegExp(`<c\\s[^>]*r="E${rowNum}"[\\s\\S]*?(?:<\\/c>|\\/>)`));
    if (eCell && /reference/i.test(cellDisplayValue(eCell[0], sharedStrings))) return rowNum;
  }
  return 1;
}

function stripCalcChain(files: FileMap): void {
  if (files["xl/calcChain.xml"]) {
    delete files["xl/calcChain.xml"];
    const ctKey = Object.keys(files).find(k => k.toLowerCase() === "[content_types].xml");
    if (ctKey) {
      const ct = decodeText(files[ctKey]).replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/i, "");
      files[ctKey] = encodeText(ct);
    }
    const rels = decodeText(files["xl/_rels/workbook.xml.rels"] || new Uint8Array())
      .replace(/<Relationship\b[^>]*Type="[^"]*\/calcChain"[^>]*\/>/i, "");
    if (files["xl/_rels/workbook.xml.rels"]) files["xl/_rels/workbook.xml.rels"] = encodeText(rels);
  }
  if (files["xl/workbook.xml"]) {
    let wb = decodeText(files["xl/workbook.xml"]);
    if (/<calcPr\b[^>]*\/>/.test(wb)) {
      wb = wb.replace(/<calcPr\b([^>]*?)\s*\/>/, (m, attrs) =>
        /\bfullCalcOnLoad\s*=/.test(attrs) ? m : `<calcPr${attrs} fullCalcOnLoad="1"/>`);
    } else {
      wb = wb.replace(/<\/workbook>/, '<calcPr calcId="191028" fullCalcOnLoad="1"/></workbook>');
    }
    files["xl/workbook.xml"] = encodeText(wb);
  }
}

function normLabel(s: string): string {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function cellMatch(sheetXml: string, ref: string): RegExpMatchArray | null {
  const re = new RegExp(`<c\\s[^>]*\\br="${ref}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`);
  return sheetXml.match(re);
}

function findCellStyle(sheetXml: string, ref: string): string | null {
  const m = cellMatch(sheetXml, ref);
  if (!m) return null;
  const sM = m[0].match(/\bs="(\d+)"/);
  return sM ? sM[1] : null;
}

function cellHasFormula(sheetXml: string, ref: string): boolean {
  const m = cellMatch(sheetXml, ref);
  return m ? /<f[\s>]/.test(m[0]) : false;
}

function setCell(sheetXml: string, ref: string, typeAttr: string, body: string, fallbackStyle?: string | null): string {
  const m = cellMatch(sheetXml, ref);
  let style = "";
  if (m) {
    const sM = m[0].match(/\bs="(\d+)"/);
    if (sM) style = ` s="${sM[1]}"`;
  } else if (fallbackStyle) {
    style = ` s="${fallbackStyle}"`;
  }
  const newCell = `<c r="${ref}"${style}${typeAttr ? ` ${typeAttr}` : ""}>${body}</c>`;
  if (m && m.index !== undefined) return sheetXml.slice(0, m.index) + newCell + sheetXml.slice(m.index + m[0].length);
  const rowNum = ref.replace(/^[A-Z]+/, "");
  const rowRe = new RegExp(`<row\\s[^>]*\\br="${rowNum}"[^>]*>[\\s\\S]*?<\\/row>`);
  const rm = sheetXml.match(rowRe);
  if (!rm || rm.index === undefined) return sheetXml;
  const insertAt = rm.index + rm[0].length - 6;
  return sheetXml.slice(0, insertAt) + newCell + sheetXml.slice(insertAt);
}

export type SlaSummaryItem = {
  metric: string;
  category: string;
  sla: string;
  count: number;
  total: number;
  actual: number;
  status?: string | null;
  writeStatus?: boolean;
};

function patchSummarySlaSheet(files: FileMap, sharedStrings: string[], summaryRows: SlaSummaryItem[]): number {
  if (!summaryRows || !summaryRows.length) return 0;
  const path = findTargetSheetPath(files, "summary_sla");
  if (!path) return 0;
  let sheetXml = decodeText(files[path]);
  const keyMap = new Map<string, SlaSummaryItem>();
  for (const item of summaryRows) {
    keyMap.set(normLabel(`${item.metric}|${item.category}|${item.sla}`), item);
  }
  const rowRe = /<row\s[^>]*r="(\d+)"[\s\S]*?<\/row>/g;
  let m: RegExpExecArray | null;
  let curMetric = "", curCat = "";
  const hits: Array<{ rowNum: string; item: SlaSummaryItem }> = [];
  while ((m = rowRe.exec(sheetXml)) !== null) {
    const rowNum = m[1];
    const body = m[0];
    const readText = (col: string): string => {
      const cm = body.match(new RegExp(`<c\\s[^>]*r="${col}${rowNum}"[\\s\\S]*?(?:<\\/c>|\\/>)`));
      return cm ? cellDisplayValue(cm[0], sharedStrings) : "";
    };
    const cVal = readText("C");
    if (cVal) curMetric = cVal;
    const eVal = readText("E");
    if (eVal) curCat = eVal;
    const fVal = readText("F");
    if (!curMetric || !fVal) continue;
    const item = keyMap.get(normLabel(`${curMetric}|${curCat}|${fVal}`));
    if (item) hits.push({ rowNum, item });
  }
  let patched = 0;
  for (const { rowNum, item } of hits) {
    const fallback = findCellStyle(sheetXml, `G${rowNum}`) || findCellStyle(sheetXml, "G4");
    sheetXml = setCell(sheetXml, `I${rowNum}`, "", `<v>${item.count}</v>`, fallback);
    sheetXml = setCell(sheetXml, `J${rowNum}`, "", `<v>${item.total}</v>`, fallback);
    const hRef = `H${rowNum}`;
    if (!cellHasFormula(sheetXml, hRef)) {
      const actualV = item.total ? String(item.actual) : "0";
      sheetXml = setCell(sheetXml, hRef, "", `<v>${actualV}</v>`, fallback);
    }
    if (item.writeStatus === false) continue;
    const kRef = `K${rowNum}`;
    if (!cellHasFormula(sheetXml, kRef)) {
      const text = String(item.status || "").toUpperCase();
      sheetXml = setCell(sheetXml, kRef, `t="inlineStr"`, `<is><t xml:space="preserve">${xmlEscape(text)}</t></is>`, fallback);
    }
    patched++;
  }
  if (patched) files[path] = encodeText(sheetXml);
  return patched;
}

// --- Weekly Summary cover sheet (the "Summary" sheet) ----------------------
//
// Unlike the tabular All_Ticket_Details fill, this sheet has fixed section
// tables (Key Incidents, Changes Implemented / Planned / Failed) plus large
// merged narrative cells. We locate each section by its header text and write
// derived rows into the rows following that section's column header, capping at
// the slots available before the next section so nothing below is clobbered.
// Narrative-only columns are left untouched for the user's editable section.

export type SummaryChangeRow = { date: number | null; systemArea: string; crNumber: string; details: string };
export type SummaryIncidentRow = {
  resolutionDate: number | null;
  systemArea: string;
  incidentNumber: string;
  details: string;
  status: string;
  rootCauseResolution: string;
};

export type SummaryDetailsData = {
  keyIncidents?: SummaryIncidentRow[];
  changesImplemented?: SummaryChangeRow[];
  changesPlanned?: SummaryChangeRow[];
  changesFailed?: SummaryChangeRow[];
  /** Free-text narrative the user typed, keyed by target cell ref (e.g. A2, A35). */
  narrative?: Record<string, string>;
};

/** Column-A display text of each row, in row order. */
function rowTextsByColumnA(sheetXml: string, sharedStrings: string[]): Array<{ rowNum: number; text: string }> {
  const out: Array<{ rowNum: number; text: string }> = [];
  const rowRe = /<row\s[^>]*r="(\d+)"[\s\S]*?<\/row>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(sheetXml)) !== null) {
    const rowNum = parseInt(m[1], 10);
    const aCell = m[0].match(new RegExp(`<c\\s[^>]*r="A${rowNum}"[\\s\\S]*?(?:<\\/c>|\\/>)`));
    out.push({ rowNum, text: aCell ? cellDisplayValue(aCell[0], sharedStrings) : "" });
  }
  return out;
}

function setNumOrText(sheetXml: string, ref: string, value: string | number | null): string {
  if (value === null || value === undefined || value === "") return sheetXml;
  if (typeof value === "number" && Number.isFinite(value)) {
    return setCell(sheetXml, ref, "", `<v>${value}</v>`);
  }
  const str = String(value);
  if (isNumericCellValue(str)) return setCell(sheetXml, ref, "", `<v>${str.trim()}</v>`);
  return setCell(sheetXml, ref, `t="inlineStr"`, `<is><t xml:space="preserve">${xmlEscape(str)}</t></is>`);
}

/**
 * Write derived cells for `rows` into consecutive sheet rows starting at
 * `firstDataRow`, stopping before `limitRow`. `cols` maps a column letter to a
 * value getter. Returns the number of rows written.
 */
function writeSectionRows(
  sheetXml: string,
  rows: Array<Record<string, string | number | null>>,
  cols: Array<{ letter: string; key: string }>,
  firstDataRow: number,
  limitRow: number
): { xml: string; written: number } {
  let xml = sheetXml;
  let written = 0;
  for (let i = 0; i < rows.length && firstDataRow + i < limitRow; i++) {
    const r = firstDataRow + i;
    for (const { letter, key } of cols) {
      xml = setNumOrText(xml, `${letter}${r}`, rows[i][key]);
    }
    written++;
  }
  return { xml, written };
}

/**
 * Empty every value cell in rows [firstRow, limitRow) — keeping each <c>
 * element and its style (s=) but stripping any <v>/<is> body and value type
 * (t="s"/"inlineStr"). Used to wipe leftover sample rows a template ships with
 * below a section's real data, so the export never shows stale rows the current
 * pull did not write. Does not touch cells that carry a formula (<f>).
 */
function clearRowCells(sheetXml: string, firstRow: number, limitRow: number): string {
  let xml = sheetXml;
  for (let r = firstRow; r < limitRow; r++) {
    const rowRe = new RegExp(`(<row\\s[^>]*\\br="${r}"[^>]*>)([\\s\\S]*?)(</row>)`);
    const rm = xml.match(rowRe);
    if (!rm || rm.index === undefined) continue;
    const inner = rm[2].replace(
      /<c(\s[^>]*?)?\br="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
      (all, _pre, col: string, rowN: string, _attrs: string, body: string | undefined) => {
        if (body !== undefined && /<f[\s>]/.test(body)) return all; // preserve formula cells
        const styleM = all.match(/\bs="(\d+)"/);
        return `<c r="${col}${rowN}"${styleM ? ` s="${styleM[1]}"` : ""}/>`;
      }
    );
    xml = xml.slice(0, rm.index) + rm[1] + inner + rm[3] + xml.slice(rm.index + rm[0].length);
  }
  return xml;
}

/**
 * Insert `count` blank rows immediately before `beforeRow`, shifting that row
 * and every row below it down by `count`. Both `<row r="N">` and each contained
 * `<c r="COLN">` reference are renumbered. Inserted rows clone the cell layout
 * (columns + style) of `templateRow` so the added rows keep the section's
 * formatting; their values are left empty for the caller to fill.
 *
 * Safe only on sheets without formulas: shifting does not rewrite formula
 * references. The Weekly Summary cover sheet is such a sheet (its tables are
 * plain values), which is why growing it here does not risk Excel's repair
 * dialog. Do NOT reuse this on formula-bearing sheets without ref rewriting.
 */
function shiftRowsDown(sheetXml: string, beforeRow: number, count: number, templateRow: number): string {
  if (count <= 0) return sheetXml;

  // 1. Renumber existing rows at/after beforeRow, bottom-up so we never create
  //    a transient duplicate row number. Collect rows first.
  const rowRe = /<row(\s[^>]*?)\br="(\d+)"([^>]*)>([\s\S]*?)<\/row>/g;
  type Row = { full: string; attrsPre: string; num: number; attrsPost: string; inner: string; index: number };
  const rows: Row[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(sheetXml)) !== null) {
    rows.push({ full: m[0], attrsPre: m[1], num: parseInt(m[2], 10), attrsPost: m[3], inner: m[4], index: m.index });
  }

  const bump = (row: Row): string => {
    const newNum = row.num + count;
    const inner = row.inner.replace(/(<c\s[^>]*\br=")([A-Z]+)(\d+)(")/g,
      (_all, p1: string, col: string, _n: string, p4: string) => `${p1}${col}${newNum}${p4}`);
    return `<row${row.attrsPre}r="${newNum}"${row.attrsPost}>${inner}</row>`;
  };

  // Rebuild the sheet: rows before beforeRow untouched; rows at/after bumped;
  // blank rows inserted at the original position of the first shifted row.
  const affected = rows.filter(r => r.num >= beforeRow).sort((a, b) => a.num - b.num);
  if (!affected.length) return sheetXml; // nothing below; caller falls back to writing at the end

  // Style/column skeleton cloned from the template row (a known data row of the
  // section) so inserted rows carry the same columns and styles, values empty.
  const tmpl = rows.find(r => r.num === templateRow);
  const blankCellsFor = (rowNum: number): string => {
    if (!tmpl) return "";
    return tmpl.inner.replace(/<c(\s[^>]*)?\br="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g,
      (_all, pre: string | undefined, col: string) => {
        const styleM = _all.match(/\bs="(\d+)"/);
        const style = styleM ? ` s="${styleM[1]}"` : "";
        return `<c r="${col}${rowNum}"${style}/>`;
      });
  };

  const insertPos = affected[0].index;
  const before = sheetXml.slice(0, insertPos);
  const after = sheetXml.slice(insertPos);

  // Replace each affected row's original text with its bumped version in `after`.
  let rebuiltAfter = after;
  // Process bottom-up so earlier replacements don't shift later indices' text.
  for (const row of [...affected].sort((a, b) => b.index - a.index)) {
    const rel = row.index - insertPos;
    rebuiltAfter = rebuiltAfter.slice(0, rel) + bump(row) + rebuiltAfter.slice(rel + row.full.length);
  }

  let blanks = "";
  for (let i = 0; i < count; i++) blanks += `<row r="${beforeRow + i}">${blankCellsFor(beforeRow + i)}</row>`;

  let result = before + blanks + rebuiltAfter;

  // Shift <mergeCells> ranges: any range whose row(s) are at/after beforeRow
  // moves down by `count`. Without this, merges below the insertion point stay
  // anchored to their old row numbers and end up covering the wrong cells
  // (e.g. a merged narrative block sliding onto a table's header cell).
  result = result.replace(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\s*\/>/g,
    (all, c1: string, r1: string, c2: string, r2: string) => {
      const n1 = parseInt(r1, 10);
      const n2 = parseInt(r2, 10);
      const nn1 = n1 >= beforeRow ? n1 + count : n1;
      const nn2 = n2 >= beforeRow ? n2 + count : n2;
      if (nn1 === n1 && nn2 === n2) return all;
      return `<mergeCell ref="${c1}${nn1}:${c2}${nn2}"/>`;
    });

  return result;
}

/**
 * Ensure a physical `<row r="N">` element exists for every N in
 * [firstRow, firstRow + count). Missing rows are created (empty, cloning the
 * column/style skeleton of `templateRow`) and spliced into row-sorted order so
 * setCell can place values there. Needed because templates often omit blank
 * rows entirely, and setCell is a no-op when the target row is absent.
 */
function ensureRowsExist(sheetXml: string, firstRow: number, count: number, templateRow: number): string {
  const rowRe = /<row\s[^>]*\br="(\d+)"[\s\S]*?<\/row>/g;
  const existing = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(sheetXml)) !== null) existing.add(parseInt(m[1], 10));

  const tmplMatch = sheetXml.match(new RegExp(`<row\\s[^>]*\\br="${templateRow}"[\\s\\S]*?<\\/row>`));
  const tmplInner = tmplMatch ? (tmplMatch[0].match(/<row[^>]*>([\s\S]*)<\/row>/) || [, ""])[1] : "";
  const skeletonFor = (rowNum: number): string =>
    String(tmplInner || "").replace(/<c(\s[^>]*)?\br="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g,
      (all, _pre, col: string) => {
        const styleM = all.match(/\bs="(\d+)"/);
        return `<c r="${col}${rowNum}"${styleM ? ` s="${styleM[1]}"` : ""}/>`;
      });

  let xml = sheetXml;
  for (let r = firstRow; r < firstRow + count; r++) {
    if (existing.has(r)) continue;
    const newRow = `<row r="${r}">${skeletonFor(r)}</row>`;
    // Insert before the first existing row whose number is greater than r; if
    // none, insert before </sheetData>.
    const nextRe = /<row\s[^>]*\br="(\d+)"[\s\S]*?<\/row>/g;
    let insertAt = -1;
    let mm: RegExpExecArray | null;
    while ((mm = nextRe.exec(xml)) !== null) {
      if (parseInt(mm[1], 10) > r) { insertAt = mm.index; break; }
    }
    if (insertAt >= 0) {
      xml = xml.slice(0, insertAt) + newRow + xml.slice(insertAt);
    } else {
      xml = xml.replace("</sheetData>", newRow + "</sheetData>");
    }
    existing.add(r);
  }
  return xml;
}

/**
 * Fill the Weekly Summary cover sheet. Locates sections by header text; returns
 * the number of table rows written across all sections (0 if the sheet or the
 * data is absent — never falls back to another sheet).
 */
function patchSummaryDetailsSheet(files: FileMap, sharedStrings: string[], data: SummaryDetailsData | null | undefined): number {
  if (!data) return 0;
  const path = findTargetSheetPath(files, "summary");
  if (!path) return 0;
  let sheetXml = decodeText(files[path]);

  // Find the row number of a section by a normalized substring of its A-column
  // text. Re-scans the CURRENT xml each call because growing a section inserts
  // rows and renumbers everything below it, so a cached snapshot would go stale.
  const findRowIn = (xml: string, needle: string): number => {
    const n = normLabel(needle);
    for (const { rowNum, text } of rowTextsByColumnA(xml, sharedStrings)) {
      if (normLabel(text).includes(n)) return rowNum;
    }
    return 0;
  };

  const changeCols = [
    { letter: "A", key: "date" },
    { letter: "B", key: "systemArea" },
    { letter: "C", key: "crNumber" },
    { letter: "D", key: "details" }
  ];
  const incidentCols = [
    { letter: "A", key: "resolutionDate" },
    { letter: "B", key: "systemArea" },
    { letter: "C", key: "incidentNumber" },
    { letter: "D", key: "details" },
    { letter: "F", key: "status" },
    { letter: "G", key: "rootCauseResolution" }
  ];

  // Section anchors (header rows). Data starts two rows below the section
  // header (section title row, then the column-header row).
  const anchorNeedles = ["Key Incidents", "Changes implemented", "Changes Planned", "Changes Failed", "Operational Health"];
  const anchorsNow = (): number[] => anchorNeedles.map((n) => findRowIn(sheetXml, n));

  // Section definitions in sheet order. Each knows its data rows and columns;
  // `nextIdx` is the anchor that bounds it (the header row below it).
  const sections: Array<{
    rows: Array<Record<string, string | number | null>> | undefined;
    cols: Array<{ letter: string; key: string }>;
    hdrIdx: number;
    nextIdx: number;
  }> = [
    { rows: data.keyIncidents, cols: incidentCols, hdrIdx: 0, nextIdx: 1 },
    { rows: data.changesImplemented, cols: changeCols, hdrIdx: 1, nextIdx: 2 },
    { rows: data.changesPlanned, cols: changeCols, hdrIdx: 2, nextIdx: 3 },
    { rows: data.changesFailed, cols: changeCols, hdrIdx: 3, nextIdx: 4 }
  ];

  // 1. Grow + materialize capacity bottom-to-top so inserting rows for a lower
  //    section never invalidates the (higher) anchors we still need. For each
  //    section: if its data exceeds the blank rows before the next header,
  //    insert the shortfall right before that header; then ensure every data
  //    row [hdr+2, hdr+2+len) physically exists (templates often omit blank
  //    rows, and setCell is a no-op on a missing row). The Summary sheet has no
  //    formulas, so shifting rows down is safe (see shiftRowsDown).
  for (let i = sections.length - 1; i >= 0; i--) {
    const s = sections[i];
    if (!s.rows || !s.rows.length) continue;
    const a = anchorsNow();
    const hdr = a[s.hdrIdx];
    const next = a[s.nextIdx];
    if (!hdr) continue;
    const firstDataRow = hdr + 2;
    if (next) {
      const available = next - firstDataRow;
      const shortfall = s.rows.length - available;
      if (shortfall > 0) sheetXml = shiftRowsDown(sheetXml, next, shortfall, firstDataRow);
    }
    sheetXml = ensureRowsExist(sheetXml, firstDataRow, s.rows.length, firstDataRow);
  }

  // 2. Fill top-to-bottom against freshly recomputed anchors. Capacity now
  //    fits, so writeSectionRows writes every row. After each section's data,
  //    clear any leftover rows up to the next header so sample rows the
  //    template ships with below the real data never survive into the export.
  let written = 0;
  const run = (
    rows: Array<Record<string, string | number | null>> | undefined,
    cols: Array<{ letter: string; key: string }>,
    hdr: number,
    limit: number
  ): void => {
    if (!hdr) return;
    const firstDataRow = hdr + 2;
    const dataLen = rows ? rows.length : 0;
    if (rows && rows.length) {
      const res = writeSectionRows(sheetXml, rows, cols, firstDataRow, limit || firstDataRow + rows.length);
      sheetXml = res.xml;
      written += res.written;
    }
    // Blank the section's trailing rows (leftover template sample data). Bounded
    // by the next header (limit); if unknown, clear a small fixed span.
    const clearFrom = firstDataRow + dataLen;
    const clearTo = limit || clearFrom;
    if (clearTo > clearFrom) sheetXml = clearRowCells(sheetXml, clearFrom, clearTo);
  };

  const a = anchorsNow();
  run(data.keyIncidents, incidentCols, a[0], a[1]);
  run(data.changesImplemented, changeCols, a[1], a[2]);
  run(data.changesPlanned, changeCols, a[2], a[3]);
  run(data.changesFailed, changeCols, a[3], a[4]);

  // Narrative free-text cells (Highlights block, Operational Health, etc.).
  if (data.narrative) {
    for (const [ref, text] of Object.entries(data.narrative)) {
      if (text) sheetXml = setNumOrText(sheetXml, ref, text);
    }
  }

  files[path] = encodeText(sheetXml);
  return written;
}

function fillTemplateBuffer(
  templateBuf: Uint8Array | ArrayBuffer,
  rows: unknown[],
  tplCols: TemplateCol[],
  sheetName?: string,
  summary?: SlaSummaryItem[],
  summaryDetails?: SummaryDetailsData
): Uint8Array {
  if (!fflate) throw new Error("fflate not available — call setFflate() first");
  const files = fflate.unzipSync(new Uint8Array(templateBuf));
  sheetName = sheetName || "all_ticket_details";
  const sheetPath = findTargetSheetPath(files, sheetName);
  if (!sheetPath) throw new Error('Template has no sheet named "' + sheetName + '"');
  const sharedStrings = parseSharedStrings(files);
  let sheetXml = decodeText(files[sheetPath]);
  const headerRow = findHeaderRowInXml(sheetXml, sharedStrings);
  const startRow = headerRow + 1;
  const lastDataRow = startRow + rows.length - 1;
  const styleMap = harvestDataCellStyles(sheetXml, startRow);
  const dataRowsXml = buildDataRowsXml(rows, startRow, styleMap, tplCols);
  sheetXml = patchSheetXml(sheetXml, sharedStrings, dataRowsXml, startRow, lastDataRow,
    colLetter(tplCols[tplCols.length - 1].col));
  files[sheetPath] = encodeText(sheetXml);
  if (summary) patchSummarySlaSheet(files, sharedStrings, summary);
  if (summaryDetails) patchSummaryDetailsSheet(files, sharedStrings, summaryDetails);
  stripCalcChain(files);
  return fflate.zipSync(files, { level: 6 });
}

export {
  normSheetName, findTargetSheetPath, parseSharedStrings, cellDisplayValue,
  harvestDataCellStyles, isNumericCellValue, buildDataRowsXml, patchSheetXml,
  findHeaderRowInXml, stripCalcChain, patchSummarySlaSheet, patchSummaryDetailsSheet, fillTemplateBuffer
};
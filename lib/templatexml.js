import { xmlEscape, decodeText, encodeText, colLetter } from "./markup.js";

let fflate = globalThis?.fflate ?? null;
export function setFflate(f) { fflate = f; }

function normSheetName(s) {
  return String(s).toLowerCase().replace(/[\s_]+/g, "");
}

function findTargetSheetPath(files, wanted) {
  const target = normSheetName(wanted);
  const wbXml = decodeText(files["xl/workbook.xml"] || new Uint8Array());
  const relsXml = decodeText(files["xl/_rels/workbook.xml.rels"] || new Uint8Array());
  const resolveRel = rid => {
    const relMatch = relsXml.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]*)"`, "i"))
      || relsXml.match(new RegExp(`<Relationship[^>]*Target="([^"]*)"[^>]*Id="${rid}"`, "i"));
    if (!relMatch) return null;
    let t = relMatch[1].replace(/^\//, "");
    if (!t.startsWith("xl/")) t = "xl/" + t;
    return files[t] ? t : null;
  };
  for (const mode of ["exact", "loose"]) {
    const tagRe = /<sheet\b[^>]*>/g;
    let m;
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

function parseSharedStrings(files) {
  const raw = files["xl/sharedStrings.xml"];
  if (!raw) return [];
  const xml = decodeText(raw);
  const items = [];
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\/>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (!m[1]) { items.push(""); continue; }
    let text = "";
    const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\/>/g;
    let t;
    while ((t = tRe.exec(m[1])) !== null) text += t[1] ?? "";
    items.push(text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, "&"));
  }
  return items;
}

function cellDisplayValue(cellXml, sharedStrings) {
  const isMatch = cellXml.match(/<is>([\s\S]*?)<\/is>/);
  if (isMatch) {
    let text = "";
    const tRe = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t\/>/g;
    let t;
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

function harvestDataCellStyles(sheetXml, startRow) {
  const openEnd = sheetXml.indexOf("</sheetData>");
  if (openEnd === -1) return {};
  const sdStart = sheetXml.lastIndexOf("<sheetData", openEnd);
  const innerStart = sheetXml.indexOf(">", sdStart) + 1;
  const inner = sheetXml.slice(innerStart, openEnd);
  const map = {};
  const rowRe = /<row\s[^>]*r="(\d+)"[\s\S]*?<\/row>/g;
  let m;
  let scanned = 0;
  while ((m = rowRe.exec(inner)) !== null) {
    const rowNum = parseInt(m[1], 10);
    if (rowNum < startRow) continue;
    if (++scanned > 50) break;
    const cellRe = /<c\s[^>]*?\br="([A-Z]+)\d+"[^>]*?(?:\/>|>)/g;
    let c;
    while ((c = cellRe.exec(m[0])) !== null) {
      const col = c[1];
      if (map[col] !== undefined) continue;
      const sM = c[0].match(/\bs="(\d+)"/);
      if (sM) map[col] = sM[1];
    }
  }
  return map;
}

function isNumericCellValue(s) {
  const t = s.trim();
  if (!t || /^0\d/.test(t)) return false;
  return /^-?\d+(\.\d+)?$/.test(t);
}

function buildDataRowsXml(rows, startRow, styleMap, tplCols) {
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

function patchSheetXml(sheetXml, sharedStrings, dataRowsXml, startRow, lastDataRow, lastColLetter) {
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
  const keptRows = [];
  const rowRe = /<row\s[^>]*r="(\d+)"[\s\S]*?<\/row>|<row\s[^>]*r="(\d+)"[^>]*\/>/g;
  let m;
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

function findHeaderRowInXml(sheetXml, sharedStrings) {
  const rowRe = /<row\s[^>]*r="(\d+)"[\s\S]*?<\/row>/g;
  let m;
  while ((m = rowRe.exec(sheetXml)) !== null) {
    const rowNum = parseInt(m[1], 10);
    if (rowNum > 30) break;
    const eCell = m[0].match(new RegExp(`<c\\s[^>]*r="E${rowNum}"[\\s\\S]*?(?:<\\/c>|\\/>)`));
    if (eCell && /reference/i.test(cellDisplayValue(eCell[0], sharedStrings))) return rowNum;
  }
  return 1;
}

function stripCalcChain(files) {
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

function normLabel(s) {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function cellMatch(sheetXml, ref) {
  const re = new RegExp(`<c\\s[^>]*\\br="${ref}"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`);
  return sheetXml.match(re);
}

function findCellStyle(sheetXml, ref) {
  const m = cellMatch(sheetXml, ref);
  if (!m) return null;
  const sM = m[0].match(/\bs="(\d+)"/);
  return sM ? sM[1] : null;
}

function cellHasFormula(sheetXml, ref) {
  const m = cellMatch(sheetXml, ref);
  return m ? /<f[\s>]/.test(m[0]) : false;
}

function setCell(sheetXml, ref, typeAttr, body, fallbackStyle) {
  const m = cellMatch(sheetXml, ref);
  let style = "";
  if (m) {
    const sM = m[0].match(/\bs="(\d+)"/);
    if (sM) style = ` s="${sM[1]}"`;
  } else if (fallbackStyle) {
    style = ` s="${fallbackStyle}"`;
  }
  const newCell = `<c r="${ref}"${style}${typeAttr ? ` ${typeAttr}` : ""}>${body}</c>`;
  if (m) return sheetXml.slice(0, m.index) + newCell + sheetXml.slice(m.index + m[0].length);
  const rowNum = ref.replace(/^[A-Z]+/, "");
  const rowRe = new RegExp(`<row\\s[^>]*\\br="${rowNum}"[^>]*>[\\s\\S]*?<\\/row>`);
  const rm = sheetXml.match(rowRe);
  if (!rm) return sheetXml;
  const insertAt = rm.index + rm[0].length - 6;
  return sheetXml.slice(0, insertAt) + newCell + sheetXml.slice(insertAt);
}

function patchSummarySlaSheet(files, sharedStrings, summaryRows) {
  if (!summaryRows || !summaryRows.length) return 0;
  const path = findTargetSheetPath(files, "summary_sla");
  if (!path) return 0;
  let sheetXml = decodeText(files[path]);
  const keyMap = new Map();
  for (const item of summaryRows) {
    keyMap.set(normLabel(`${item.metric}|${item.category}|${item.sla}`), item);
  }
  const rowRe = /<row\s[^>]*r="(\d+)"[\s\S]*?<\/row>/g;
  let m;
  let curMetric = "", curCat = "";
  const hits = [];
  while ((m = rowRe.exec(sheetXml)) !== null) {
    const rowNum = m[1];
    const body = m[0];
    const readText = col => {
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

function fillTemplateBuffer(templateBuf, rows, tplCols, sheetName, summary) {
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
  stripCalcChain(files);
  return fflate.zipSync(files, { level: 6 });
}

export {
  normSheetName, findTargetSheetPath, parseSharedStrings, cellDisplayValue,
  harvestDataCellStyles, isNumericCellValue, buildDataRowsXml, patchSheetXml,
  findHeaderRowInXml, stripCalcChain, patchSummarySlaSheet, fillTemplateBuffer
};

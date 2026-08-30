import type { ViewerRow } from "./core.ts";
import type { ViewerCol } from "./core.ts";

export function parseClipboardBlock(text: string): string[][] | null {
  if (!text) return null;
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const rows: string[][] = lines.map(line => {
    if (line.includes("\t")) return line.split("\t").map(cell => trimCell(cell));
    if (line.includes(",")) return line.split(",").map(cell => trimCell(cell));
    return [trimCell(line)];
  });
  while (rows.length && rows[rows.length - 1].every(c => c === "")) rows.pop();
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  if (!rows.length || !width) return null;
  return rows.map(r => {
    const out = r.slice();
    while (out.length < width) out.push("");
    return out;
  });
}

function trimCell(v: string): string {
  return String(v).trim();
}

export function buildFillGrid(source: string[][], targetRows: number, targetCols: number): string[][] {
  const fs = source.length;
  const fc = fs && source[0] ? source[0].length : 0;
  const out: string[][] = [];
  for (let r = 0; r < targetRows; r++) {
    const srcR = fs ? r % fs : 0;
    out[r] = [];
    for (let c = 0; c < targetCols; c++) {
      const srcC = fc ? c % fc : 0;
      out[r][c] = source[srcR][srcC];
    }
  }
  return out;
}

export type PasteDeps = {
  parseLocal?: (text: string) => Date | null;
  listFor?: (key: string, row: ViewerRow) => string[] | null;
};

export function storedValue(value: unknown, key: string, cls: string, row: ViewerRow, deps?: PasteDeps): unknown {
  const s = value === null || value === undefined ? "" : String(value);
  if (cls === "inst") {
    const t = s.trim();
    if (!t) return "";
    const d = deps && deps.parseLocal ? deps.parseLocal(t) : null;
    return d ? d.toISOString() : s;
  }
  const list = deps && deps.listFor ? deps.listFor(key, row) : null;
  if (list && list.length) {
    const hit = list.find(o => String(o).toLowerCase() === s.trim().toLowerCase());
    if (hit) return hit;
  }
  return s;
}

export function originRowValues(rows: ViewerRow[], cols: ViewerCol[], lo: number, lc: number, hc: number): unknown[] {
  const out: unknown[] = [];
  for (let c = lc; c <= hc; c++) {
    const [key] = cols[c];
    out.push(rows[lo][key]);
  }
  return out;
}
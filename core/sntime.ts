function pmHour(h: number, ap: string): number {
  if (/p/i.test(ap || "") && h < 12) return h + 12;
  if (/a/i.test(ap || "") && h === 12) return 0;
  return h;
}

/**
 * Parse a display-format-dating datetime string to epoch ms. Tolerant of
 * ISO yyyy-MM-dd, dd-MM-yyyy, dd.MM.yyyy, and MM/dd/yyyy, with optional AM/PM.
 */
function parseSnDisplayMs(s: string): number | null {
  const str = String(s || "").trim();
  if (!str) return null;
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
  if (!m) {
    m = str.match(/^(\d{1,2})[-.](\d{1,2})[-.](\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
    if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], pmHour(+m[4], m[7]), +m[5], +(m[6] || 0));
    m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/);
    if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2], pmHour(+m[4], m[7]), +m[5], +(m[6] || 0));
    const p = Date.parse(str);
    return Number.isFinite(p) ? p : null;
  }
  return Date.UTC(+m[1], +m[2] - 1, +m[3], pmHour(+m[4], m[7]), +m[5], +(m[6] || 0));
}

/** Return display-minus-raw offset in ms, or null if unparseable. */
function pairOffsetMs(disp: string | undefined, raw: string | undefined): number | null {
  const d = String(disp || "");
  const r = String(raw || "");
  if (!d || !r) return null;
  const de = parseSnDisplayMs(d);
  const re = Date.parse(r.replace(" ", "T") + (/Z$|[+-]\d\d:?\d\d$/.test(r) ? "" : "Z"));
  if (de == null || isNaN(re)) return null;
  return de - re;
}

type OffsetRow = { openedAt?: string; openedAtRaw?: string };

/** Return median instance offset in ms over up to 200 sampled rows. */
function detectSnOffsetMs(rows: OffsetRow[] | null | undefined): number {
  const offs: number[] = [];
  for (const r of rows || []) {
    const o = pairOffsetMs(r.openedAt, r.openedAtRaw);
    if (o != null && Math.abs(o) < 15 * 3600e3) offs.push(o);
    if (offs.length >= 200) break;
  }
  if (!offs.length) return 0;
  offs.sort((a, b) => a - b);
  const mid = offs.length >> 1;
  return offs.length % 2 ? offs[mid] : Math.round((offs[mid - 1] + offs[mid]) / 2);
}

/**
 * Resolve a row's OWN instance offset from its openedAt display/raw pair.
 */
function rowOffsetMs(row: OffsetRow | undefined | null, fallback: number): number {
  const o = pairOffsetMs(row?.openedAt, row?.openedAtRaw);
  return o == null ? (fallback || 0) : o;
}

/** Format v (epoch ms string/number) with the given offset, as ISO-ish text. */
function fmtWithOffset(v: string | number, offsetMs: number): string {
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  const p = (n: number) => String(n).padStart(2, "0");
  const s = new Date(d.getTime() + (offsetMs || 0));
  return `${s.getUTCFullYear()}-${p(s.getUTCMonth() + 1)}-${p(s.getUTCDate())} ` +
    `${p(s.getUTCHours())}:${p(s.getUTCMinutes())}:${p(s.getUTCSeconds())}`;
}

export { parseSnDisplayMs, pmHour, pairOffsetMs, detectSnOffsetMs, rowOffsetMs, fmtWithOffset };
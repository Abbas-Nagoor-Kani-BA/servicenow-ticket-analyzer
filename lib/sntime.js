function pmHour(h, ap) {
  if (/p/i.test(ap || "") && h < 12) return h + 12;
  if (/a/i.test(ap || "") && h === 12) return 0;
  return h;
}

function parseSnDisplayMs(s) {
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

function pairOffsetMs(disp, raw) {
  const d = String(disp || "");
  const r = String(raw || "");
  if (!d || !r) return null;
  const de = parseSnDisplayMs(d);
  const re = Date.parse(r.replace(" ", "T") + (/Z$|[+-]\d\d:?\d\d$/.test(r) ? "" : "Z"));
  if (de == null || isNaN(re)) return null;
  return de - re;
}

function detectSnOffsetMs(rows) {
  const offs = [];
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

function rowOffsetMs(row, fallback) {
  const o = pairOffsetMs(row?.openedAt, row?.openedAtRaw);
  return o == null ? (fallback || 0) : o;
}

function fmtWithOffset(v, offsetMs) {
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  const p = n => String(n).padStart(2, "0");
  const s = new Date(d.getTime() + (offsetMs || 0));
  return `${s.getUTCFullYear()}-${p(s.getUTCMonth() + 1)}-${p(s.getUTCDate())} ` +
    `${p(s.getUTCHours())}:${p(s.getUTCMinutes())}:${p(s.getUTCSeconds())}`;
}


export { parseSnDisplayMs, pmHour, pairOffsetMs, detectSnOffsetMs, rowOffsetMs, fmtWithOffset };

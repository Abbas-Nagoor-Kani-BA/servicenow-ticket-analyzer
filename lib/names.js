/**
 * Normalize an array of name entries (legacy `{name}` objects or plain strings)
 * into a de-duplicated array of trimmed, non-empty name strings. Used by the
 * options page (settings) and the pull pipeline (background) so both share one
 * migration + dedupe rule.
 * @param {Array<string | {name?: unknown} | null | undefined>} arr
 * @returns {string[]}
 */
export function normalizeNames(arr) {
  const seen = new Set();
  const out = [];
  for (const p of arr || []) {
    const n = String(p && typeof p === "object" ? p.name ?? "" : p ?? "").trim();
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/**
 * Parse a multi-line name list from an options-page textarea. Each line is
 * trimmed and any legacy `Name | sys_id` tail is stripped; results are
 * de-duplicated case-insensitively.
 * @param {string} text
 * @returns {string[]}
 */
export function parseNameLines(text) {
  return normalizeNames(String(text).split("\n").map((s) => s.replace(/\s*[|=]\s*.*$/, "").trim()));
}

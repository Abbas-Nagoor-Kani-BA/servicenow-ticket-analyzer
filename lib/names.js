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

/**
 * Split a free-text value list on newlines, commas and semicolons, then apply
 * the same trimming, legacy `Name | sys_id` stripping and case-insensitive
 * de-duplication as parseNameLines.
 *
 * Moved here from settings/chips.js so components and surfaces share one
 * implementation instead of a component depending on a surface.
 * @param {string} text
 * @returns {string[]}
 */
export function splitTerms(text) {
  return parseNameLines(String(text ?? "").replace(/[\n,;]+/g, "\n"));
}

import { $, COLUMNS } from "./core.ts";
import type { ViewerRow } from "./core.ts";
import { dataStore } from "./store.ts";
import { rowMatches } from "./search-match.ts";
import type { DisplayValue } from "./search-match.ts";
import { getSearchColumn, getSearchMode, isCaseSensitive } from "./search-state.ts";

function st() { return dataStore.getState(); }

// The value the search matches against, per column. Injected at boot with
// exportSvc.cellValue so search matches the displayed/exported value (and thus
// aligns with what copy/export emit). Until injected, fall back to the raw row
// field so the module works standalone (and in unit tests).
let displayValue: DisplayValue = (row, key) => {
  const v = row[key];
  return v === null || v === undefined ? "" : String(v);
};

/** Inject the displayed/export value resolver (exportSvc.cellValue-bound). */
function setDisplayValueResolver(fn: DisplayValue): void {
  if (typeof fn === "function") displayValue = fn;
}

function currentRows(): ViewerRow[] {
  const { data, sortKey, sortDir } = st();
  let rows = data ? [...data.rows] : [];
  const q = $("search").value;
  if (q.trim()) {
    const opts = { column: getSearchColumn(), mode: getSearchMode(), caseSensitive: isCaseSensitive() };
    rows = rows.filter((r) => rowMatches(r, q, opts, displayValue, COLUMNS));
  }
  if (sortKey) {
    rows.sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey];
      const na = Number(va), nb = Number(vb);
      if (Number.isFinite(na) && Number.isFinite(nb) && va !== "" && vb !== "") {
        return (na - nb) * sortDir;
      }
      return String(va ?? "").localeCompare(String(vb ?? ""), undefined, { numeric: true }) * sortDir;
    });
  }
  return rows;
}

function hasDataRows(): boolean {
  const data = st().data;
  return !!(data && data.rows.length);
}

function parseLocalInput(text: string): Date | null {
  const t = text.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  }
  const dmy = t.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dmy) {
    return new Date(+dmy[3], +dmy[2] - 1, +dmy[1], +(dmy[4] || 0), +(dmy[5] || 0), +(dmy[6] || 0));
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

export { currentRows, hasDataRows, parseLocalInput, setDisplayValueResolver };
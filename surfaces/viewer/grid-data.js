import { $, COLUMNS } from "./core.js";
import { dataStore } from "./store.js";

function st() { return dataStore.getState(); }

function currentRows() {
  const { data, sortKey, sortDir } = st();
  let rows = data ? [...data.rows] : [];
  const q = $("search").value.trim().toLowerCase();
  if (q) {
    rows = rows.filter(r =>
      COLUMNS.some(([k]) => String(r[k] ?? "").toLowerCase().includes(q))
    );
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

function hasDataRows() {
  const data = st().data;
  return !!(data && data.rows.length);
}

function parseLocalInput(text) {
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

export { currentRows, hasDataRows, parseLocalInput };

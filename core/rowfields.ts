type Row = Record<string, unknown>;

/** True for catalog tasks (SCTASK…), whose parent is a request item (RITM). */
export function isScTask(row: Row): boolean {
  return String(row.number ?? "").toUpperCase().startsWith("SCTASK");
}

/**
 * The ticket number to display/export. For catalog tasks this is the parent
 * RITM number (row.requestItem); if that is missing it falls back to the
 * SCTASK number. All other ticket types use their own number unchanged.
 */
export function displayNumber(row: Row): string {
  if (isScTask(row)) {
    const ritm = String(row.requestItem ?? "").trim();
    if (ritm) return ritm;
  }
  return String(row.number ?? "");
}

/**
 * The priority cell for MSR copy / export. Catalog tasks are RFS work, so their
 * priority cell is the literal "RFS" rather than a numeric priority. Every
 * other ticket type passes its priority through unchanged.
 */
export function priorityCell(row: Row): string {
  if (isScTask(row)) return "RFS";
  return row.priority === null || row.priority === undefined ? "" : String(row.priority);
}

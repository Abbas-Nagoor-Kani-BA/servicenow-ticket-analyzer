import type { ViewerRow } from "./core.ts";
import { exportSvc } from "./exporter.ts";

export { tsvCell } from "../../services/export-service.ts";

export const MSR_COLUMNS = exportSvc.msrColumns;

export function buildMsrTsv(rows: ViewerRow[]): string {
  return exportSvc.buildMsrTsv(rows);
}

export function cellValue(row: ViewerRow, key: string, cls: string): string {
  return exportSvc.cellValue(row, key, cls);
}
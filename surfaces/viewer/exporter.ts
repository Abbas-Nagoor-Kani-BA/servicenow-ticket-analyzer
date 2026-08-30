import { fmtInstant } from "./grid.ts";
import {
  ExportService, DEFAULT_EXPORT_MAP, MAP_MAX_COL, TPL_SHEET_NAME, expStr
} from "../../services/export-service.ts";
import type { ReportFmt } from "../../services/report-service.ts";

export type {
  TplCol, ExportGroup, ExportFieldGet, ExportFieldDef
} from "../../services/export-service.ts";

export { DEFAULT_EXPORT_MAP, MAP_MAX_COL, TPL_SHEET_NAME, expStr };

// Single export-service instance per viewer page, bound to the grid's
// instance-clock formatter so exported dates and the template fill match what
// the grid shows. All the work lives in services/export-service.ts; this module
// is only a composition binding.
export const exportSvc = new ExportService(fmtInstant as ReportFmt);

export const TPL_COLUMNS = exportSvc.tplColumns;
export const EXPORT_GROUPS = exportSvc.exportGroups;
export const EXPORT_FIELD_BY_ID = exportSvc.fieldById;
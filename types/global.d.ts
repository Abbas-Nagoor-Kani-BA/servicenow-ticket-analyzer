// Ambient globals that resolve across the repo's classic/ES module boundary.
// Declared with `var` (not `const`) so they also become properties of
// `typeof globalThis` — the code reads `globalThis.chrome` / `globalThis.Analysis`.
export {};

declare global {
  var chrome: any;
  var fflate: any;
  var g_ck: any;
  var Analysis: any;
  var AiExtract: any;
  var Markup: any;
  var Journal: any;
  var Report: any;
  var RowMerge: any;
  var TemplateXml: any;
  var MsrChoices: any;

  // Decorated by ServiceNowClient#request (lib/servicenow.js) on the
  // Response object returned by the pluggable transport.
  interface Response {
    snVia?: string | null;
    snHadToken?: boolean | null;
    snTokenSource?: string | null;
  }
}

// Cross-context message protocol. RUN/COUNT flow panel -> background;
// PROGRESS/DATA_UPDATED flow background -> panel. Reused by JSDoc in callers.
export type MsgRun = {
  type: "RUN";
  instanceUrl: string;
  groups: string[];
  filterSets: { table: string; conditions: unknown[]; queueNames?: string[] }[];
  filters?: Record<string, unknown>;
  fields?: string[];
  maxTickets?: number;
  /** When true, additionally pull change_request rows for the weekly Summary. */
  includeChangeSummary?: boolean;
};
export type MsgCount = {
  type: "COUNT";
  instanceUrl: string;
  groups: string[];
  filterSets?: { table: string; conditions: unknown[] }[];
  filters?: Record<string, unknown>;
};
export type MsgProgress = {
  type: "PROGRESS";
  stage: string;
  detail?: unknown;
  [k: string]: unknown;
};
export type MsgDataUpdated = { type: "DATA_UPDATED" };
export type MsgSnFetch = {
  type: "SN_FETCH";
  url: string;
  token: string;
  method?: string;
  body?: unknown;
};
export type BackgroundMessage =
  | MsgRun
  | MsgCount
  | MsgProgress
  | MsgDataUpdated
  | MsgSnFetch;

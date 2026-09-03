export const STORAGE = Object.freeze({
  pluginSettings: "pluginSettings",
  msrLists: "msrLists",
  lastData: "lastData",
  lastRun: "lastRun",
  viewerSel: "viewerSel",
  viewerHiddenCols: "viewerHiddenCols",
  viewerColWidths: "viewerColWidths",
  calclensHighlights: "calclensHighlights",
  viewerActionRail: "viewerActionRail",
  exportColMap: "exportColMap",
  ciSplit: "ciSplit",
  snXlsxTemplate: "snXlsxTemplate",
  snFilterList: "snFilterList"
} as const);

export const MSG = Object.freeze({
  run: "RUN",
  count: "COUNT",
  ping: "PING",
  progress: "PROGRESS",
  dataUpdated: "DATA_UPDATED",
  snFetch: "SN_FETCH"
} as const);

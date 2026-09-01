import { createStore } from "../../lib/store.ts";
import { onStorageChange, loadOnce, saveValue, removeValue } from "../../lib/storage.ts";
import { STORAGE } from "../../lib/keys.ts";
import * as MsrChoices from "../../core/msrchoices.ts";
import type { ViewerData, MsrLists } from "./core.ts";

export type SelPoint = { sysId: string; key: string };

type DataState = {
  data: ViewerData | null;
  sortKey: string | null;
  sortDir: number;
  snOffsetMs: number;
  selfPush: boolean;
  saveTimer: ReturnType<typeof setTimeout> | null;
};

type SelState = {
  anchor: SelPoint | null;
  focus: SelPoint | null;
  prev: HTMLElement[];
  pending: { a: SelPoint; f: SelPoint } | null;
};

type UiState = {
  hiddenCols: Set<string>;
  colWidths: Record<string, number>;
  msrLists: MsrLists;
};

export const dataStore = createStore<DataState>({
  data: null,
  sortKey: null,
  sortDir: 1,
  snOffsetMs: 0,
  selfPush: false,
  saveTimer: null
});

export const selStore = createStore<SelState>({
  anchor: null,
  focus: null,
  prev: [],
  pending: null
});

export const uiStore = createStore<UiState>({
  hiddenCols: new Set(),
  colWidths: {},
  msrLists: MsrChoices.mergeMsrLists(null)
});

export function getSelfPush() { return dataStore.getState().selfPush; }
export function setSelfPush(v: boolean) { dataStore.setState({ selfPush: v }); }

export function setHiddenCols(set: Set<string>) { uiStore.setState({ hiddenCols: set }); }
export function getColWidths() { return uiStore.getState().colWidths; }
export function setColWidths(widths: Record<string, number>) { uiStore.setState({ colWidths: widths || {} }); }
export function getMsrLists(): MsrLists { return uiStore.getState().msrLists; }
export function setMsrLists(lists: unknown) {
  uiStore.setState({ msrLists: MsrChoices.mergeMsrLists(lists as MsrChoices.MsrListOverrides | null | undefined) });
}

export async function hydrateStores() {
  const [lastData, viewerSel, hiddenCols, colWidths, storedLists] = await Promise.all([
    loadOnce<ViewerData>(STORAGE.lastData, null),
    loadOnce<{ a: SelPoint; f: SelPoint }>(STORAGE.viewerSel, null),
    loadOnce<string[]>(STORAGE.viewerHiddenCols, []),
    loadOnce<Record<string, number>>(STORAGE.viewerColWidths, {}),
    loadOnce<{ lists?: Record<string, unknown> }>(STORAGE.msrLists, null)
  ]);
  const hc = new Set(Array.isArray(hiddenCols) ? hiddenCols : []);
  dataStore.setState({ data: lastData || null });
  selStore.setState({ pending: viewerSel && viewerSel.a && viewerSel.f ? viewerSel : null });
  uiStore.setState({ hiddenCols: hc, colWidths: (colWidths && typeof colWidths === "object") ? colWidths : {} });
  setMsrLists(storedLists && storedLists.lists ? storedLists.lists : null);
}

export async function saveColWidths() {
  await saveValue(STORAGE.viewerColWidths, getColWidths());
}

export async function saveSel() {
  const { anchor, focus } = selStore.getState();
  if (anchor && focus) {
    await saveValue(STORAGE.viewerSel, { a: anchor, f: focus });
  } else {
    await removeValue(STORAGE.viewerSel);
  }
}

export type ViewerHandlers = {
  onData(data: ViewerData | null): void;
  onLists(lists: unknown): void;
};

export function wireViewer(handlers: ViewerHandlers) {
  const unData = onStorageChange([STORAGE.lastData], () => {
    if (dataStore.getState().selfPush) return;
    loadOnce<ViewerData>(STORAGE.lastData, null).then((d) => handlers.onData(d || null));
  });
  const unLists = onStorageChange([STORAGE.msrLists], (hit) => {
    const lists = hit.msrLists && hit.msrLists.lists ? hit.msrLists.lists : null;
    setMsrLists(lists);
    handlers.onLists(lists);
  });
  return () => { unData(); unLists(); };
}
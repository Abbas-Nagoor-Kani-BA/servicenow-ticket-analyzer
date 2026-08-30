import { createStore } from "../../lib/store.js";
import { onStorageChange, loadOnce, saveValue, removeValue } from "../../lib/storage.js";
import { STORAGE } from "../../lib/keys.ts";
import * as MsrChoices from "../../core/msrchoices.js";

export const dataStore = createStore({
  data: null,
  sortKey: null,
  sortDir: 1,
  snOffsetMs: 0,
  selfPush: false,
  saveTimer: null
});

export const selStore = createStore({
  anchor: null,
  focus: null,
  prev: [],
  pending: null
});

export const uiStore = createStore({
  hiddenCols: new Set(),
  colWidths: {},
  msrLists: null
});

export function getSelfPush() { return dataStore.getState().selfPush; }
export function setSelfPush(v) { dataStore.setState({ selfPush: v }); }

export function setHiddenCols(set) { uiStore.setState({ hiddenCols: set }); }
export function getColWidths() { return uiStore.getState().colWidths; }
export function setColWidths(widths) { uiStore.setState({ colWidths: widths || {} }); }
export function getMsrLists() { return uiStore.getState().msrLists; }
export function setMsrLists(lists) {
  uiStore.setState({ msrLists: MsrChoices.mergeMsrLists(lists ?? null) });
}

export async function hydrateStores() {
  const [lastData, viewerSel, hiddenCols, colWidths, storedLists] = await Promise.all([
    loadOnce(STORAGE.lastData, null),
    loadOnce(STORAGE.viewerSel, null),
    loadOnce(STORAGE.viewerHiddenCols, []),
    loadOnce(STORAGE.viewerColWidths, {}),
    loadOnce(STORAGE.msrLists, null)
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

export function wireViewer(handlers) {
  const unData = onStorageChange([STORAGE.lastData], () => {
    if (dataStore.getState().selfPush) return;
    if (document.querySelector("td.edit-input")) return;
    loadOnce(STORAGE.lastData, null).then((d) => handlers.onData(d || null));
  });
  const unLists = onStorageChange([STORAGE.msrLists], (hit) => {
    const lists = hit.msrLists && hit.msrLists.lists ? hit.msrLists.lists : null;
    setMsrLists(lists);
    handlers.onLists(lists);
  });
  return () => { unData(); unLists(); };
}

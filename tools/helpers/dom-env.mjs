// Browser-environment bootstrap for DOM-level viewer tests.
// Import this module FIRST — it installs happy-dom globals and chrome stubs
// before any viewer module is dynamically imported.

import { Window } from "happy-dom";

const win = new Window({ url: "https://viewer.local/" });

const store = new Map();
const sentMessages = [];
const messageListeners = new Set();
const downloads = [];

function normKeys(keys) {
  if (keys === null || keys === undefined) return null;
  if (typeof keys === "string") return [keys];
  if (Array.isArray(keys)) return keys;
  return Object.keys(keys);
}

export const chrome = {
  storage: {
    local: {
      get(keys, cb) {
        const out = {};
        const list = normKeys(keys);
        if (!list) return Promise.resolve(Object.fromEntries(store));
        for (const k of list) if (store.has(k)) out[k] = JSON.parse(JSON.stringify(store.get(k)));
        const result = Promise.resolve(out);
        if (cb) queueMicrotask(() => cb(out));
        return result;
      },
      set(obj, cb) {
        for (const [k, v] of Object.entries(obj || {})) store.set(k, JSON.parse(JSON.stringify(v)));
        const done = Promise.resolve();
        if (cb) queueMicrotask(() => cb());
        return done;
      },
      remove(keys, cb) {
        for (const k of normKeys(keys) || []) store.delete(k);
        if (cb) cb();
        return Promise.resolve();
      }
    }
  },
  runtime: {
    onMessage: { addListener: fn => messageListeners.add(fn) },
    sendMessage: msg => { sentMessages.push(msg); return Promise.resolve(); },
    getURL: p => "chrome-extension://test/" + p
  },
  downloads: {
    download: (options, cb) => { downloads.push(options); if (cb) cb(); }
  },
  sidePanel: { setPanelBehavior: async () => {} }
};

Object.defineProperty(win, "isSecureContext", { value: true, configurable: true });
globalThis.window = win;
globalThis.document = win.document;
Object.defineProperty(globalThis, "navigator", { value: win.navigator, configurable: true });
globalThis.localStorage = win.localStorage;
globalThis.HTMLElement = win.HTMLElement;
globalThis.HTMLInputElement = win.HTMLInputElement;
globalThis.Element = win.Element;
globalThis.Node = win.Node;
if (!win.HTMLCollection.prototype[Symbol.iterator]) {
  win.HTMLCollection.prototype[Symbol.iterator] = function* () {
    for (let i = 0; i < this.length; i++) yield this[i];
  };
}
if (!("rows" in win.HTMLTableSectionElement.prototype)) {
  Object.defineProperty(win.HTMLTableSectionElement.prototype, "rows", {
    get() {
      return Array.from(this.children).filter(c => c.tagName === "TR");
    },
    configurable: true
  });
}
globalThis.HTMLCollection = win.HTMLCollection;
globalThis.CSS = win.CSS ?? { escape: s => String(s).replace(/[^\w-]/g, c => "\\" + c) };
globalThis.customElements = win.customElements;
globalThis.getComputedStyle = win.getComputedStyle.bind(win);
globalThis.requestAnimationFrame = cb => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = id => clearTimeout(id);
let lastCopied = null;
Object.defineProperty(win.navigator, "clipboard", {
  value: { writeText: async t => { lastCopied = t; } },
  configurable: true
});
export function getLastCopied() { return lastCopied; }
globalThis.chrome = chrome;

export function getDownloads() {
  return downloads.map(d => ({ filename: d.filename, url: d.url, saveAs: d.saveAs }));
}
export function clearDownloads() {
  downloads.length = 0;
}

export function seed(key, value) {
  if (value === undefined) { store.delete(key); return; }
  store.set(key, typeof value === "string" ? value : JSON.parse(JSON.stringify(value)));
}
export function seedAll(obj) {
  for (const [k, v] of Object.entries(obj)) seed(k, v);
}
export function peek(key) {
  const v = store.get(key);
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}
export function sentMessagesList() {
  return sentMessages;
}
export async function flush(times = 4) {
  for (let i = 0; i < times; i++) await new Promise(r => setTimeout(r, 0));
}

const SKELETON = `
<div class="toolbar">
  <div class="tbLeft">
    <input id="search">
    <span id="count"></span>
  </div>
  <div class="tbRight">
    <span id="status"></span>
    <div id="exportCluster">
      <button id="exportBtn" class="primary">Export</button>
    </div>
    <input type="file" id="tplFile" accept=".xlsx" class="hidden">
    <button id="copyMsrBtn">Copy for MSR</button>
    <button id="colsBtn">Columns</button>
    <div id="colMenu" class="hidden">
      <div class="menuHead"><span>Visible columns</span><button id="showAllCols">Show all</button></div>
      <input id="colSearch">
      <div id="colList"></div>
    </div>
    <button id="clearBtn">Clear</button>
  </div>
</div>
<div id="slaBar" class="hidden"></div>
<div id="tabs">
  <button id="tabTickets" class="tab on" role="tab" aria-selected="true"><span class="g">☰</span> Tickets</button>
  <button id="tabSummary" class="tab" role="tab" aria-selected="false"><span class="g">Σ</span> Summary SLA</button>
</div>
  <div id="wrap">
    <table id="tbl"><thead></thead><tbody></tbody></table>
  </div>
<div id="summaryWrap" class="hidden">
  <div id="sumMeta"></div>
  <div class="table-wrapper">
    <table id="sumIncTbl" class="sum-table incident-table">
      <colgroup><col><col><col><col><col><col><col><col><col></colgroup>
      <thead></thead><tbody></tbody>
    </table>
  </div>
  <div class="table-wrapper">
    <table id="sumProbTbl" class="sum-table problem-table">
      <colgroup><col><col><col><col><col><col><col><col><col></colgroup>
      <thead></thead><tbody></tbody>
    </table>
  </div>
</div>
<div id="empty" class="hidden">No pulled data yet.</div>
<div id="mapModal" class="hidden">
  <div id="letterPop" class="hidden"><input id="letterSearch"><div id="letterList"></div></div>
  <div id="mapCard">
    <div class="mapHead"><span>Export column mapping</span><button id="mapClose">✕</button></div>
    <p class="mapHint"></p>
    <input id="mapSearch">
    <div id="mapList"></div>
    <div class="mapFoot">
      <button id="mapReset">Reset</button><span class="spacer"></span>
      <button id="mapCancel">Cancel</button><button id="mapSave" class="primary">Save</button>
    </div>
  </div>
</div>
<div id="ciModal" class="hidden">
  <div id="ciCard">
    <div class="mapHead"><span>Split</span><button id="ciClose">✕</button></div>
    <label class="ciToggle"><input type="checkbox" id="ciEnabled"></label>
    <p class="mapHint">An item matches every configuration item that contains it (anywhere in the name) — e.g. "Payment Gateway" also matches "Payment Gateway PRD / PreLive / DEV / TEST" and "Web Payment Gateway". Longest match wins; the rest go to Others.</p>
    <div id="groupBoard"></div>
    <button id="addGroupBtn">+ Add group</button>
    <div class="mapFoot"><button id="ciSave" class="primary">Save</button>
    <button id="ciDisable">Disable</button><button id="ciCancel">Cancel</button></div>
  </div>
</div>
<div id="configModal" class="hidden">
  <div id="configCard">
    <div class="mapHead"><span>Export configuration</span><button id="configClose">✕</button></div>
    <p class="mapHint"></p>
    <div class="cfgRows">
      <div class="cfgRow">
        <span class="cfgLabel">Template</span>
        <span class="cfgValue" id="cfgTplLabel"></span>
        <span class="cfgActions">
          <button id="cfgTplBtn">Choose template…</button>
          <button id="cfgTplClear" class="hidden">Clear</button>
        </span>
      </div>
      <div class="cfgRow">
        <span class="cfgLabel">Files</span>
        <span class="cfgValue" id="cfgSplitLabel"></span>
        <span class="cfgActions"><button id="cfgCiBtn">Edit groups…</button></span>
      </div>
      <div class="cfgRow">
        <span class="cfgLabel">Column mapping</span>
        <span class="cfgValue" id="cfgMapLabel"></span>
        <span class="cfgActions"><button id="cfgMapBtn">Edit mapping…</button></span>
      </div>
    </div>
    <div class="radioRow">
      <label><input type="radio" name="splitMode" id="radSingle" checked> Single file</label>
      <label><input type="radio" name="splitMode" id="radSplit"> Separate files per CI group</label>
    </div>
    <div id="cfgSplitPreview" class="hidden"></div>
    <div class="mapFoot">
      <button id="configCancel">Cancel</button>
      <span class="spacer"></span>
      <button id="configExport" class="primary">Export</button>
    </div>
  </div>
</div>
`;

export function installSkeleton() {
  document.body.innerHTML = SKELETON;
}

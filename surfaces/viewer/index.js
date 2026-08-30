import "./store.js";
import "./core.js";
import "./cols.js";
import "./config-state.js";
import "./exporter.js";
import "./clipboard.js";
import "./summary.js";
import "./paste.js";
import "./toolbar.js";
import "./dialogs.js";
import "./grid.js";
import "./selection.js";
import "./ticketpop.js";
import "./activity.js";
import "./editors.js";
import "./shared.js";
import "./interactions.js";
import { loadTplInfo } from "./toolbar.js";
import { dataStore, hydrateStores, wireViewer } from "./store.js";
import { load } from "./grid.js";
import { syncMsrLists } from "./core.js";
import { anyOverlayOpen } from "./selection.js";
import { initTooltips } from "../../lib/tooltip.js";

async function boot() {
  initTooltips(() => anyOverlayOpen());
  await hydrateStores();
  wireViewer({ onData: load, onLists: syncMsrLists });
  loadTplInfo();
  const data = dataStore.getState().data;
  if (data) load(data);
}

boot();

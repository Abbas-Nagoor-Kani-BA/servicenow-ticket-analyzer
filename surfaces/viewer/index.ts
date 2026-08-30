/**
 * Composition root for the viewer page.
 *
 * The viewer used to be wired by import side effects: the old viewer.js
 * imported eighteen modules in numeric order and each one bound its own DOM
 * handlers as it was evaluated. That made the wiring invisible and the numeric
 * file names load-bearing.
 *
 * Every module now exports its wiring as an init*() function and this file is
 * the only place that knows the order and the boot sequence. The init order
 * below is the order the old evaluation order produced, measured rather than
 * assumed: summary -> grid -> cols -> dialogs -> toolbar -> interactions. It
 * matters for the three document-level keydown handlers (summary, dialogs,
 * interactions), which run in registration order on a shared target.
 */

import { dataStore, hydrateStores, wireViewer } from "./store.js";
import { syncMsrLists } from "./core.js";
import { initSummary } from "./summary.js";
import { initGrid, load } from "./grid.js";
import { initCols } from "./cols.js";
import { initDialogs } from "./dialogs.js";
import { initToolbar, loadTplInfo } from "./toolbar.js";
import { initInteractions } from "./interactions.js";
import { anyOverlayOpen } from "./selection.js";
import { initTooltips } from "../../lib/tooltip.js";

// Modules that carry no wiring of their own. They are imported for their
// registrations and for module state that the modules above depend on.
import "./config-state.js";
import "./exporter.js";
import "./clipboard.js";
import "./paste.js";
import "./ticketpop.js";
import "./activity.js";
import "./editors.js";
import "./shared.js";

async function boot() {
  initSummary();
  initGrid();
  initCols();
  initDialogs();
  initToolbar();
  initInteractions();

  initTooltips(() => anyOverlayOpen());
  await hydrateStores();
  wireViewer({ onData: load, onLists: syncMsrLists });
  loadTplInfo();
  const data = dataStore.getState().data;
  if (data) load(data);
}

boot();

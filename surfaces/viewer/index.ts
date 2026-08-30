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

import { dataStore, hydrateStores, wireViewer } from "./store.ts";
import { syncMsrLists } from "./core.ts";
import { initSummary } from "./summary.ts";
import { initGrid, load } from "./grid.ts";
import { initCols } from "./cols.ts";
import { initDialogs } from "./dialogs.ts";
import { initToolbar, loadTplInfo } from "./toolbar.ts";
import { initInteractions } from "./interactions.ts";
import { anyOverlayOpen } from "./selection.ts";
import { initTooltips } from "../../lib/tooltip.ts";

// Modules that carry no wiring of their own. They are imported for their
// registrations and for module state that the modules above depend on.
import "./config-state.ts";
import "./exporter.ts";
import "./clipboard.ts";
import "./paste.ts";
import "./ticketpop.ts";
import "./activity.ts";
import "./editors.ts";
import "./shared.ts";

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

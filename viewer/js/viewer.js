import "./00-store.js";
import "./00-core.js";
import "./10-exporter.js";
import "./15-clipboard.js";
import "./16-summary.js";
import "./17-paste.js";
import "./20-toolbar.js";
import "./25-dialogs.js";
import "./30-grid.js";
import "./40-selection.js";
import "./50-ticketpop.js";
import "./60-activity.js";
import "./70-editors.js";
import "./85-shared.js";
import "./95-interactions.js";
import { loadTplInfo } from "./20-toolbar.js";
import { dataStore, hydrateStores, wireViewer } from "./00-store.js";
import { load } from "./30-grid.js";
import { syncMsrLists } from "./00-core.js";
import { anyOverlayOpen } from "./40-selection.js";
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

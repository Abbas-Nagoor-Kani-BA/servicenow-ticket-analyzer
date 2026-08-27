import "./00-core.js";
import "./10-exporter.js";
import "./15-clipboard.js";
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

loadTplInfo();
console.log("viewer modules loaded");

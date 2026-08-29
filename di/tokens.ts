import { token } from "./token.ts";

import type { KeyValueStore } from "../data/key-value-store.ts";
import type { IdbDatabase } from "../data/idb.ts";
import type { SnRemote } from "../data/datasource/sn-remote.ts";
import type { Notifier } from "../data/repositories/dataset-repository.ts";
import type { DatasetRepository } from "../data/repositories/dataset-repository.ts";
import type { ExportConfigRepository } from "../data/repositories/export-config-repository.ts";
import type { FilterListRepository } from "../data/repositories/filter-list-repository.ts";
import type { RunStateRepository } from "../data/repositories/run-state-repository.ts";
import type { SettingsRepository } from "../data/repositories/settings-repository.ts";
import type { TemplateRepository } from "../data/repositories/template-repository.ts";
import type { TicketRepository } from "../data/repositories/ticket-repository.ts";
import type { TimelineRepository } from "../data/repositories/timeline-repository.ts";
import type { ViewerPrefsRepository } from "../data/repositories/viewer-prefs-repository.ts";

/*
 * Central token registry.
 *
 * Imports above are `import type` only, so this module emits no runtime
 * reference to the repositories. That keeps the graph acyclic even though every
 * repository imports its token back from here.
 */

// Infrastructure
export const KEY_VALUE_STORE = token<KeyValueStore>("key-value-store");
export const NOTIFIER = token<Notifier>("notifier");
export const IDB = token<IdbDatabase>("idb");
export const SN_REMOTE = token<SnRemote>("sn-remote");

// Repositories — chrome.storage backed
export const SETTINGS_REPO = token<SettingsRepository>("settings-repo");
export const DATASET_REPO = token<DatasetRepository>("dataset-repo");
export const RUN_STATE_REPO = token<RunStateRepository>("run-state-repo");
export const EXPORT_CONFIG_REPO = token<ExportConfigRepository>("export-config-repo");
export const VIEWER_PREFS_REPO = token<ViewerPrefsRepository>("viewer-prefs-repo");
export const TEMPLATE_REPO = token<TemplateRepository>("template-repo");
export const FILTER_LIST_REPO = token<FilterListRepository>("filter-list-repo");

// Repositories — IndexedDB cache + ServiceNow remote (service worker only)
export const TICKET_REPO = token<TicketRepository>("ticket-repo");
export const TIMELINE_REPO = token<TimelineRepository>("timeline-repo");

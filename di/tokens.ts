import { token } from "./token.ts";

import type { ConnectionService } from "../services/connection-service.ts";
import type { PullService } from "../services/pull-service.ts";

import type { IdbDatabase } from "../data/idb.ts";
import type { SnRemote } from "../data/datasource/sn-remote.ts";
import type { KeyValueStore } from "../data/key-value-store.ts";
import type { DatasetRepository, Notifier, TicketRow } from "../data/repositories/dataset-repository.ts";
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
 * Every import is `import type`, so this module emits no runtime reference to
 * the things it names. That keeps the graph acyclic even though every
 * repository and service imports its token back from here.
 */

// Infrastructure
export const KEY_VALUE_STORE = token<KeyValueStore>("key-value-store");
export const NOTIFIER = token<Notifier>("notifier");
export const IDB = token<IdbDatabase>("idb");
export const SN_REMOTE = token<SnRemote>("sn-remote");

/**
 * Builds a remote bound to one instance URL. Registered only in the service
 * worker: the token and content-script relay it needs do not exist in a page.
 */
export type SnRemoteFactory = (
  instanceUrl: string,
  onDiagnostic?: (d: any) => void
) => SnRemote | Promise<SnRemote>;
export const SN_REMOTE_FACTORY = token<SnRemoteFactory>("sn-remote-factory");

/** The repositories scoped to a single pull, sharing one remote. */
export type RunScope = {
  tickets: TicketRepository;
  timelines: TimelineRepository;
};
export type RunScopeFactory = (
  instanceUrl: string,
  onDiagnostic?: (d: any) => void
) => Promise<RunScope>;
export const RUN_SCOPE_FACTORY = token<RunScopeFactory>("run-scope-factory");

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

// Services
export const PULL_SERVICE = token<PullService>("pull-service");
export const CONNECTION_SERVICE = token<ConnectionService>("connection-service");

export type { TicketRow };

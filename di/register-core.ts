import { Container } from "./container.ts";
import {
  DATASET_REPO,
  EXPORT_CONFIG_REPO,
  FILTER_LIST_REPO,
  KEY_VALUE_STORE,
  NOTIFIER,
  RUN_STATE_REPO,
  SETTINGS_REPO,
  TEMPLATE_REPO,
  VIEWER_PREFS_REPO
} from "./tokens.ts";

import { createChromeKeyValueStore } from "../data/chrome-key-value-store.ts";
import { DatasetStore } from "../data/repositories/dataset-repository.ts";
import { ExportConfigStore } from "../data/repositories/export-config-repository.ts";
import { FilterListStore } from "../data/repositories/filter-list-repository.ts";
import { RunStateStore } from "../data/repositories/run-state-repository.ts";
import { SettingsStore } from "../data/repositories/settings-repository.ts";
import { TemplateStore } from "../data/repositories/template-repository.ts";
import { ViewerPrefsStore } from "../data/repositories/viewer-prefs-repository.ts";

/**
 * Registers the storage-backed repositories every surface needs.
 *
 * Surfaces call this, then override what they must (a memory store in tests, a
 * spying notifier in the background) via `container.child()`.
 */
export function registerCoreRepositories(c: Container): Container {
  if (!c.has(KEY_VALUE_STORE)) {
    c.registerValue(KEY_VALUE_STORE, createChromeKeyValueStore());
  }
  if (!c.has(NOTIFIER)) {
    c.registerValue(NOTIFIER, defaultNotifier);
  }

  c.registerClass(SETTINGS_REPO, SettingsStore, { singleton: true });
  c.registerClass(DATASET_REPO, DatasetStore, { singleton: true });
  c.registerClass(RUN_STATE_REPO, RunStateStore, { singleton: true });
  c.registerClass(EXPORT_CONFIG_REPO, ExportConfigStore, { singleton: true });
  c.registerClass(VIEWER_PREFS_REPO, ViewerPrefsStore, { singleton: true });
  c.registerClass(TEMPLATE_REPO, TemplateStore, { singleton: true });
  c.registerClass(FILTER_LIST_REPO, FilterListStore, { singleton: true });

  return c;
}

/** Builds a root container with the core repositories registered. */
export function createRootContainer(): Container {
  return registerCoreRepositories(new Container());
}

const defaultNotifier = (msg: Record<string, unknown>): void => {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) return;
  runtime.sendMessage(msg).catch(() => undefined);
};

import { STORAGE } from "../../lib/keys.ts";
import { KEY_VALUE_STORE } from "../../di/tokens.ts";
import type { KeyValueStore } from "../key-value-store.ts";

export type PluginParams = {
  tablePageSize?: number;
  debugResponses?: boolean;
  cacheTtlMinutes?: number;
  maxTicketsPerPull?: number;
};

export type PluginMl = {
  enabled?: boolean;
  mode?: "always" | "fallback";
  modelId?: string;
  cacheEnabled?: boolean;
};

export type PluginDefaults = {
  ticketType?: string;
  queues?: string[];
  teamMembers?: string[];
};

export type PluginSettings = {
  version: number;
  instanceUrl: string;
  defaults: PluginDefaults;
  params?: PluginParams;
  ml?: PluginMl;
};

export interface SettingsRepository {
  load(): Promise<PluginSettings | null>;
  save(settings: PluginSettings): Promise<void>;
  onChange(handler: (settings: PluginSettings | null) => void): () => void;
}

export class SettingsStore implements SettingsRepository {
  static readonly deps = [KEY_VALUE_STORE] as const;

  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  load(): Promise<PluginSettings | null> {
    return this.store.get<PluginSettings | null>(STORAGE.pluginSettings, null);
  }

  save(settings: PluginSettings): Promise<void> {
    return this.store.set(STORAGE.pluginSettings, settings);
  }

  onChange(handler: (settings: PluginSettings | null) => void): () => void {
    return this.store.onChanged([STORAGE.pluginSettings], (hit) => {
      handler((hit[STORAGE.pluginSettings] as PluginSettings) ?? null);
    });
  }
}

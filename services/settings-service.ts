import { SETTINGS_REPO } from "../di/tokens.ts";
import type { SettingsRepository } from "../data/repositories/settings-repository.ts";

import { mergeMsrLists, MSR_DEFAULT_LISTS } from "../core/msrchoices.ts";

export type SettingsDraft = {
  version: number;
  instanceUrl: string;
  defaults: {
    ticketType: string;
    queues: string[];
    teamMembers: string[];
  };
  params: {
    tablePageSize: number;
    debugResponses: boolean;
    cacheTtlMinutes: number;
    maxTicketsPerPull: number;
  };
  ml: {
    enabled: boolean;
    mode: "always" | "fallback";
    modelId: string;
    cacheEnabled: boolean;
  };
};

export const TICKET_TYPES = ["incident", "change_request", "problem", "sc_req_item", "sc_task"];

export const SETTINGS_DEFAULTS: SettingsDraft = {
  version: 2,
  instanceUrl: "",
  defaults: {
    ticketType: "incident",
    queues: [],
    teamMembers: []
  },
  params: {
    tablePageSize: 1000,
    debugResponses: false,
    cacheTtlMinutes: 15,
    maxTicketsPerPull: 500
  },
  ml: {
    enabled: false,
    mode: "fallback",
    modelId: "mobilebert",
    cacheEnabled: true
  }
};

function clampInt(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

function cloneDefaults(): SettingsDraft {
  return structuredClone(SETTINGS_DEFAULTS);
}

/**
 * Normalises persisted settings: fills gaps with defaults, coerces the numeric
 * params into range, and migrates the single-queue `queueName` field the
 * options page used before queues became a list.
 *
 * Pure, so it can be tested without storage.
 */
export function normaliseSettings(raw: unknown): SettingsDraft {
  const merged = cloneDefaults();
  if (!raw || typeof raw !== "object") return merged;
  const s = raw as Record<string, any>;

  if (typeof s.instanceUrl === "string") merged.instanceUrl = s.instanceUrl;

  if (s.defaults && typeof s.defaults === "object") {
    Object.assign(merged.defaults, s.defaults);
    if (!Array.isArray(merged.defaults.queues) || !merged.defaults.queues.length) {
      if (typeof s.defaults.queueName === "string" && s.defaults.queueName) {
        merged.defaults.queues = [s.defaults.queueName];
      }
    }
  }
  if (!TICKET_TYPES.includes(merged.defaults.ticketType)) merged.defaults.ticketType = "incident";

  if (s.params && typeof s.params === "object") Object.assign(merged.params, s.params);

  merged.params.tablePageSize = clampInt(merged.params.tablePageSize, 100, 5000, SETTINGS_DEFAULTS.params.tablePageSize);
  merged.params.cacheTtlMinutes = clampInt(merged.params.cacheTtlMinutes, 0, 10080, SETTINGS_DEFAULTS.params.cacheTtlMinutes);
  merged.params.maxTicketsPerPull = clampInt(merged.params.maxTicketsPerPull, 0, 1e5, SETTINGS_DEFAULTS.params.maxTicketsPerPull);
  merged.params.debugResponses = !!merged.params.debugResponses;

  if (s.ml && typeof s.ml === "object") Object.assign(merged.ml, s.ml);
  merged.ml.enabled = !!merged.ml.enabled;
  if (merged.ml.mode !== "always") merged.ml.mode = "fallback";
  if (typeof merged.ml.modelId !== "string" || !merged.ml.modelId) merged.ml.modelId = SETTINGS_DEFAULTS.ml.modelId;
  if (typeof merged.ml.cacheEnabled !== "boolean") merged.ml.cacheEnabled = SETTINGS_DEFAULTS.ml.cacheEnabled;

  return merged;
}

/**
 * Settings reads and writes for the options page.
 *
 * The page never touches `chrome.storage` itself; it hands a draft to `save()`
 * and receives a normalised draft from `load()`.
 */
export class SettingsService {
  static readonly deps = [SETTINGS_REPO] as const;

  private readonly settings: SettingsRepository;

  constructor(settings: SettingsRepository) {
    this.settings = settings;
  }

  load(): Promise<SettingsDraft> {
    return this.settings.load().then(normaliseSettings);
  }

  save(draft: SettingsDraft): Promise<void> {
    return this.settings.save(normaliseSettings(draft));
  }

  reset(): Promise<SettingsDraft> {
    const defaults = cloneDefaults();
    return this.settings.save(defaults).then(() => defaults);
  }

  /** The effective MSR lists, falling back to the built-in defaults. */
  msrLists(raw: unknown): Record<string, unknown> {
    return mergeMsrLists(raw && typeof raw === "object" ? (raw as { lists?: unknown }).lists ?? null : null);
  }

  defaultMsrLists(): Record<string, unknown> {
    return mergeMsrLists(MSR_DEFAULT_LISTS);
  }
}

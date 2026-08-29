import { STORAGE } from "../../lib/keys.ts";
import { KEY_VALUE_STORE } from "../../di/tokens.ts";
import type { KeyValueStore } from "../key-value-store.ts";

export type CiSplitGroup = {
  name: string;
  items: string[];
};

export type CiSplit = {
  enabled: boolean;
  groups: CiSplitGroup[];
};

export type ExportColumnMap = Record<string, string>;

export interface ExportConfigRepository {
  loadCiSplit(): Promise<CiSplit>;
  saveCiSplit(split: CiSplit): Promise<void>;
  loadColumnMap(): Promise<ExportColumnMap>;
  saveColumnMap(map: ExportColumnMap): Promise<void>;
}

const EMPTY_SPLIT: CiSplit = { enabled: false, groups: [] };

/**
 * Coerces persisted CI-split data. Older builds stored a flat `items: string[]`
 * instead of `groups`, and both shapes exist in the wild.
 */
export function normalizeCiSplit(raw: unknown): CiSplit {
  if (!raw || typeof raw !== "object") return { ...EMPTY_SPLIT };
  const value = raw as { enabled?: unknown; groups?: unknown; items?: unknown };
  const enabled = value.enabled === true;

  if (Array.isArray(value.groups)) {
    const groups = value.groups
      .filter((g): g is Record<string, unknown> => !!g && typeof g === "object")
      .map((g) => ({
        name: String(g.name ?? ""),
        items: Array.isArray(g.items) ? g.items.filter((x): x is string => typeof x === "string" && !!x.trim()) : []
      }))
      .filter((g) => g.name || g.items.length);
    return { enabled, groups };
  }

  if (Array.isArray(value.items)) {
    const groups = value.items
      .filter((x): x is string => typeof x === "string" && !!x.trim())
      .map((ci) => ({ name: ci, items: [ci] }));
    return { enabled, groups };
  }

  return { enabled, groups: [] };
}

export class ExportConfigStore implements ExportConfigRepository {
  static readonly deps = [KEY_VALUE_STORE] as const;

  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  async loadCiSplit(): Promise<CiSplit> {
    const raw = await this.store.get<unknown>(STORAGE.ciSplit, null);
    return normalizeCiSplit(raw);
  }

  saveCiSplit(split: CiSplit): Promise<void> {
    return this.store.set(STORAGE.ciSplit, split);
  }

  loadColumnMap(): Promise<ExportColumnMap> {
    return this.store.get<ExportColumnMap>(STORAGE.exportColMap, {});
  }

  saveColumnMap(map: ExportColumnMap): Promise<void> {
    return this.store.set(STORAGE.exportColMap, map);
  }
}

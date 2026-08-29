import { STORAGE } from "../../lib/keys.ts";
import { KEY_VALUE_STORE } from "../../di/tokens.ts";
import type { KeyValueStore } from "../key-value-store.ts";

/** A saved panel filter set: a table plus its encoded-query conditions. */
export type FilterSet = {
  table: string;
  conditions: unknown[];
  queueNames?: string[];
  [key: string]: unknown;
};

export interface FilterListRepository {
  load(): Promise<FilterSet[]>;
  save(sets: FilterSet[]): Promise<void>;
  clear(): Promise<void>;
}

export class FilterListStore implements FilterListRepository {
  static readonly deps = [KEY_VALUE_STORE] as const;

  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  async load(): Promise<FilterSet[]> {
    const raw = await this.store.get<unknown>(STORAGE.snFilterList, []);
    if (!Array.isArray(raw)) return [];
    return raw.filter((s): s is FilterSet => !!s && typeof s === "object");
  }

  save(sets: FilterSet[]): Promise<void> {
    return this.store.set(STORAGE.snFilterList, sets);
  }

  clear(): Promise<void> {
    return this.store.remove(STORAGE.snFilterList);
  }
}

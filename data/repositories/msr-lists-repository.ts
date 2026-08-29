import { STORAGE } from "../../lib/keys.ts";
import { KEY_VALUE_STORE } from "../../di/tokens.ts";
import type { KeyValueStore } from "../key-value-store.ts";

export type MsrLists = {
  version: number;
  lists: Record<string, any>;
};

export interface MsrListsRepository {
  load(): Promise<MsrLists | null>;
  save(value: MsrLists): Promise<void>;
  clear(): Promise<void>;
}

export class MsrListsStore implements MsrListsRepository {
  static readonly deps = [KEY_VALUE_STORE] as const;

  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  load(): Promise<MsrLists | null> {
    return this.store.get<MsrLists | null>(STORAGE.msrLists, null);
  }

  save(value: MsrLists): Promise<void> {
    return this.store.set(STORAGE.msrLists, value);
  }

  clear(): Promise<void> {
    return this.store.remove(STORAGE.msrLists);
  }
}

import { STORAGE } from "../../lib/keys.ts";
import { KEY_VALUE_STORE } from "../../di/tokens.ts";
import type { KeyValueStore } from "../key-value-store.ts";

export type LastRun = {
  at: string;
  instance: string;
  query: string;
  group: string;
  tickets: number;
};

export interface RunStateRepository {
  load(): Promise<LastRun | null>;
  save(run: LastRun): Promise<void>;
  onChange(handler: (run: LastRun | null) => void): () => void;
}

export class RunStateStore implements RunStateRepository {
  static readonly deps = [KEY_VALUE_STORE] as const;

  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  load(): Promise<LastRun | null> {
    return this.store.get<LastRun | null>(STORAGE.lastRun, null);
  }

  save(run: LastRun): Promise<void> {
    return this.store.set(STORAGE.lastRun, run);
  }

  onChange(handler: (run: LastRun | null) => void): () => void {
    return this.store.onChanged([STORAGE.lastRun], (hit) => {
      handler((hit[STORAGE.lastRun] as LastRun) ?? null);
    });
  }
}

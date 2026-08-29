import { MSG, STORAGE } from "../../lib/keys.ts";
import { KEY_VALUE_STORE, NOTIFIER } from "../../di/tokens.ts";
import type { KeyValueStore } from "../key-value-store.ts";

/** A row of the pulled, analysed dataset. Shape is ticket-type dependent. */
export type TicketRow = Record<string, any>;

export type RunEntry = {
  at: string;
  table: string;
  group: string;
  query: string;
  pulled: number;
  new?: number;
  cached?: boolean;
  cacheAt?: number | null;
  skippedLimit?: boolean;
  matched?: number;
};

export type Dataset = {
  at: string;
  instance: string;
  missingAudit: number;
  totalPulled: number;
  debug?: Record<string, unknown>;
  runs: RunEntry[];
  rows: TicketRow[];
};

/** Sends a runtime message to the other extension surfaces. */
export type Notifier = (msg: Record<string, unknown>) => Promise<void> | void;

export interface DatasetRepository {
  load(): Promise<Dataset | null>;
  save(dataset: Dataset): Promise<void>;
  clear(): Promise<void>;
  onChange(handler: (dataset: Dataset | null) => void): () => void;
  /** Tells the other surfaces the dataset changed (MSG.dataUpdated). */
  broadcastChanged(): Promise<void>;
}

const defaultNotifier: Notifier = (msg) => {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) return;
  return runtime.sendMessage(msg).catch(() => undefined) as Promise<void>;
};

/**
 * Owns `lastData` — the combined pulled dataset the viewer renders.
 *
 * `broadcastChanged` lives here rather than in a service because writing the
 * dataset and announcing it are the same operation; callers should not need to
 * know the message type.
 */
export class DatasetStore implements DatasetRepository {
  static readonly deps = [KEY_VALUE_STORE, NOTIFIER] as const;

  private readonly store: KeyValueStore;
  private readonly notify: Notifier;

  constructor(store: KeyValueStore, notify: Notifier = defaultNotifier) {
    this.store = store;
    this.notify = notify;
  }

  load(): Promise<Dataset | null> {
    return this.store.get<Dataset | null>(STORAGE.lastData, null);
  }

  save(dataset: Dataset): Promise<void> {
    return this.store.set(STORAGE.lastData, dataset);
  }

  clear(): Promise<void> {
    return this.store.remove(STORAGE.lastData);
  }

  onChange(handler: (dataset: Dataset | null) => void): () => void {
    return this.store.onChanged([STORAGE.lastData], (hit) => {
      handler((hit[STORAGE.lastData] as Dataset) ?? null);
    });
  }

  async broadcastChanged(): Promise<void> {
    await this.notify({ type: MSG.dataUpdated });
  }
}

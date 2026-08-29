/**
 * Minimal key/value contract every `chrome.storage.local` repository sits on.
 *
 * Repositories depend on this interface rather than on `chrome.storage`
 * directly, so `createMemoryKeyValueStore()` gives tests the real repository
 * code with no extension-API mocking at all.
 */
export interface KeyValueStore {
  get<T>(key: string, fallback: T): Promise<T>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  /** Fires with `{ key: newValue }` for the watched keys. Returns an unsubscribe. */
  onChanged(keys: string[], handler: ChangeHandler): () => void;
}

export type ChangeHandler = (changes: Record<string, unknown>) => void;

export type MemoryKeyValueStore = KeyValueStore & {
  snapshot(): Record<string, unknown>;
  emitExternal(key: string, value: unknown): void;
};

/**
 * In-memory `KeyValueStore` for tests and for non-extension contexts.
 *
 * `emitExternal` simulates a write arriving from another extension surface,
 * which is how the viewer learns about a pull finished in the background.
 */
export function createMemoryKeyValueStore(initial: Record<string, unknown> = {}): MemoryKeyValueStore {
  const data: Record<string, unknown> = { ...initial };
  const listeners = new Set<{ keys: Set<string>; handler: ChangeHandler }>();

  const notify = (changed: string[]): void => {
    for (const entry of [...listeners]) {
      const hit: Record<string, unknown> = {};
      let matched = false;
      for (const key of changed) {
        if (!entry.keys.has(key)) continue;
        hit[key] = data[key];
        matched = true;
      }
      if (matched) entry.handler(hit);
    }
  };

  return {
    async get<T>(key: string, fallback: T): Promise<T> {
      return key in data ? (data[key] as T) : fallback;
    },
    async set<T>(key: string, value: T): Promise<void> {
      data[key] = value;
      notify([key]);
    },
    async remove(key: string): Promise<void> {
      delete data[key];
      notify([key]);
    },
    onChanged(keys: string[], handler: ChangeHandler): () => void {
      const entry = { keys: new Set(keys), handler };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    snapshot(): Record<string, unknown> {
      return { ...data };
    },
    emitExternal(key: string, value: unknown): void {
      data[key] = value;
      notify([key]);
    }
  };
}

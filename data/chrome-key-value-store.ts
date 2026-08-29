import type { ChangeHandler, KeyValueStore } from "./key-value-store.ts";

/**
 * `KeyValueStore` backed by `chrome.storage.local`.
 *
 * Every method degrades to a no-op outside an extension context so the same
 * repositories can be constructed in plain node.
 */
export function createChromeKeyValueStore(): KeyValueStore {
  const local = (): any => globalThis.chrome?.storage?.local ?? null;

  return {
    async get<T>(key: string, fallback: T): Promise<T> {
      const store = local();
      if (!store) return fallback;
      try {
        const res = await store.get([key]);
        return res && key in res ? (res[key] as T) : fallback;
      } catch {
        return fallback;
      }
    },

    async set<T>(key: string, value: T): Promise<void> {
      const store = local();
      if (!store) return;
      try {
        await store.set({ [key]: value });
      } catch {
        /* quota or context invalidated — nothing useful to do */
      }
    },

    async remove(key: string): Promise<void> {
      const store = local();
      if (!store) return;
      try {
        await store.remove([key]);
      } catch {
        /* ignore */
      }
    },

    onChanged(keys: string[], handler: ChangeHandler): () => void {
      const onChanged = globalThis.chrome?.storage?.onChanged;
      if (!onChanged) return () => {};
      const wanted = new Set(keys);
      const listener = (changes: Record<string, any>, area: string): void => {
        if (area !== "local") return;
        const hit: Record<string, unknown> = {};
        let any = false;
        for (const key of Object.keys(changes)) {
          if (wanted.has(key)) {
            hit[key] = changes[key]?.newValue;
            any = true;
          }
        }
        if (any) handler(hit);
      };
      onChanged.addListener(listener);
      return () => onChanged.removeListener(listener);
    }
  };
}

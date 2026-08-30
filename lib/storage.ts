export function loadOnce<T>(key: string, fallback: T | null = null): Promise<T | null> {
  if (!globalThis.chrome?.storage?.local) return Promise.resolve(fallback);
  return chrome.storage.local
    .get([key])
    .then((res: Record<string, unknown>) => (res && key in res ? (res[key] as T) : fallback))
    .catch(() => fallback);
}

export function saveValue(key: string, value: unknown): Promise<void> {
  if (!globalThis.chrome?.storage?.local) return Promise.resolve();
  return chrome.storage.local.set({ [key]: value }).catch(() => {});
}

export function removeValue(key: string): Promise<void> {
  if (!globalThis.chrome?.storage?.local) return Promise.resolve();
  return chrome.storage.local.remove([key]).catch(() => {});
}

/**
 * Fire-and-forget runtime message broadcast (e.g. MSG.dataUpdated).
 */
export function broadcast(msg: object): Promise<void> {
  if (!globalThis.chrome?.runtime?.sendMessage) return Promise.resolve();
  return chrome.runtime.sendMessage(msg).catch(() => {});
}

type StorageChange = { newValue?: unknown; oldValue?: unknown };

export function onStorageChange(
  keys: string[],
  handler: (changes: Record<string, any>) => void
): () => void {
  if (!globalThis.chrome?.storage?.onChanged) return () => {};
  const wanted = new Set(keys);
  const listener = (changes: Record<string, StorageChange>, area: string) => {
    if (area !== "local") return;
    const hit: Record<string, any> = {};
    let any = false;
    for (const key of Object.keys(changes)) {
      if (wanted.has(key)) {
        hit[key] = changes[key].newValue;
        any = true;
      }
    }
    if (any) handler(hit);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

type StoreLike<S> = { getState: () => S };

export function persistSlice<S, K extends keyof S>(
  store: StoreLike<S>,
  sliceName: K,
  key: string,
  debounceMs = 300
): { save(): void; flush(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  const flush = () => {
    timer = null;
    pending = false;
    saveValue(key, store.getState()[sliceName]);
  };
  return {
    save() {
      if (pending && timer) {
        clearTimeout(timer);
        timer = setTimeout(flush, debounceMs);
        return;
      }
      pending = true;
      timer = setTimeout(flush, debounceMs);
    },
    flush() {
      if (timer) clearTimeout(timer);
      flush();
    }
  };
}
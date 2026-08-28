export function loadOnce(key, fallback = null) {
  if (!globalThis.chrome?.storage?.local) return Promise.resolve(fallback);
  return chrome.storage.local
    .get([key])
    .then((res) => (res && key in res ? res[key] : fallback))
    .catch(() => fallback);
}

export function saveValue(key, value) {
  if (!globalThis.chrome?.storage?.local) return Promise.resolve();
  return chrome.storage.local.set({ [key]: value }).catch(() => {});
}

export function removeValue(key) {
  if (!globalThis.chrome?.storage?.local) return Promise.resolve();
  return chrome.storage.local.remove([key]).catch(() => {});
}

/**
 * Fire-and-forget runtime message broadcast (e.g. MSG.dataUpdated).
 * @param {object} msg
 * @returns {Promise<void>}
 */
export function broadcast(msg) {
  if (!globalThis.chrome?.runtime?.sendMessage) return Promise.resolve();
  return chrome.runtime.sendMessage(msg).catch(() => {});
}

export function onStorageChange(keys, handler) {
  if (!globalThis.chrome?.storage?.onChanged) return () => {};
  const wanted = new Set(keys);
  const listener = (changes, area) => {
    if (area !== "local") return;
    const hit = {};
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

export function persistSlice(store, sliceName, key, debounceMs = 300) {
  let timer = null;
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

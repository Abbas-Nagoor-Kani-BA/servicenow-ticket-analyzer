/**
 * Thin IndexedDB wrapper for the pull caches.
 *
 * Repositories depend on this interface, so `createMemoryDatabase()` gives
 * tests the real cache logic without an IndexedDB mock — which is what
 * `issues/001` Priority 7 has been waiting on.
 */

export type IdbStore = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  /** Deletes every entry whose value matches. Returns how many were removed. */
  deleteWhere(predicate: (value: any) => boolean): Promise<number>;
};

export interface IdbDatabase {
  store(name: string): IdbStore;
  clearAll(): Promise<void>;
  close(): void;
}

const DB_NAME = "snAnalyzerCache";
const DB_VERSION = 1;

let defaultDb: IdbDatabase | null = null;

/**
 * Process-wide default database. Surfaces that only need to clear the cache
 * (the Settings page) use this instead of opening their own connection.
 */
export function getDefaultDatabase(): IdbDatabase {
  if (!defaultDb) defaultDb = createIdbDatabase();
  return defaultDb;
}

export function createIdbDatabase(
  name: string = DB_NAME,
  version: number = DB_VERSION,
  storeNames: string[] = ["queries", "timelines"]
): IdbDatabase {
  let dbPromise: Promise<any> | null = null;

  const open = (): Promise<any> => {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(name, version);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const storeName of storeNames) {
            if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
      });
    }
    return dbPromise;
  };

  /**
   * Runs `fn` inside a transaction.
   *
   * `fn` returns either a bare request (whose `.result` is the resolved value)
   * or `{ getResult }` when it needs to own the request's handlers itself —
   * which cursors must, since walking them happens in `onsuccess`. Assigning
   * `onsuccess` here for those would clobber the walk and silently no-op.
   */
  const tx = <T>(storeName: string, mode: IDBTransactionMode, fn: (store: any) => any): Promise<T> =>
    open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const transaction = db.transaction(storeName, mode);
          let out: any;
          let getResult: (() => T) | undefined;

          const returned = fn(transaction.objectStore(storeName));
          if (returned && typeof returned === "object" && typeof returned.getResult === "function") {
            getResult = returned.getResult;
          } else if (returned && typeof returned === "object" && "onsuccess" in returned) {
            returned.onsuccess = () => {
              out = returned.result;
            };
          }

          transaction.oncomplete = () => resolve(getResult ? getResult() : (out as T));
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error("transaction aborted"));
        })
    );

  const store = (name: string): IdbStore => ({
    get: <T>(key: string) => tx<T | undefined>(name, "readonly", (s) => s.get(key)),
    put: <T>(key: string, value: T) => tx<void>(name, "readwrite", (s) => s.put(value, key)),
    delete: (key: string) => tx<void>(name, "readwrite", (s) => s.delete(key)),
    clear: () => tx<void>(name, "readwrite", (s) => s.clear()),
    deleteWhere: (predicate: (value: any) => boolean) =>
      tx<number>(name, "readwrite", (s) => {
        let removed = 0;
        const cursorRequest = s.openCursor();
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          if (predicate(cursor.value)) {
            cursor.delete();
            removed++;
          }
          cursor.continue();
        };
        return { getResult: () => removed };
      })
  });

  return {
    store,
    async clearAll(): Promise<void> {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(storeNames, "readwrite");
        for (const storeName of storeNames) transaction.objectStore(storeName).clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    },
    close(): void {
      if (!dbPromise) return;
      dbPromise.then((db) => db.close()).catch(() => undefined);
      dbPromise = null;
    }
  };
}

/** In-memory `IdbDatabase` for tests and non-browser contexts. */
export function createMemoryDatabase(storeNames: string[] = ["queries", "timelines"]): IdbDatabase {
  const stores = new Map<string, Map<string, any>>();
  for (const name of storeNames) stores.set(name, new Map());

  const mustGet = (name: string): Map<string, any> => {
    const found = stores.get(name);
    if (!found) throw new Error(`Unknown object store "${name}"`);
    return found;
  };

  return {
    store(name: string): IdbStore {
      return {
        async get<T>(key: string): Promise<T | undefined> {
          return mustGet(name).get(key) as T | undefined;
        },
        async put<T>(key: string, value: T): Promise<void> {
          mustGet(name).set(key, value);
        },
        async delete(key: string): Promise<void> {
          mustGet(name).delete(key);
        },
        async clear(): Promise<void> {
          mustGet(name).clear();
        },
        async deleteWhere(predicate: (value: any) => boolean): Promise<number> {
          const map = mustGet(name);
          let removed = 0;
          for (const [key, value] of [...map]) {
            if (predicate(value)) {
              map.delete(key);
              removed++;
            }
          }
          return removed;
        }
      };
    },
    async clearAll(): Promise<void> {
      for (const map of stores.values()) map.clear();
    },
    close(): void {
      /* nothing to release */
    }
  };
}

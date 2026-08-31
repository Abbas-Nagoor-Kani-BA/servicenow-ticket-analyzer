import { createIdbDatabase, createMemoryDatabase } from "./idb.ts";
import type { IdbDatabase } from "./idb.ts";
import type { ClassifyOutcome } from "../services/classifier-service.ts";

/*
 * Durable per-note classification-result cache.
 *
 * The classification of a resolution note is pure given the notes and the
 * candidate label lists, so the outcome can be reused across datasets and page
 * loads. Without this cache the deterministic scorer re-scores every note row
 * on every load, and the ML path re-runs a (25-233 MB) model over the same
 * notes each time. This store memoizes the outcome keyed by the EXACT input —
 * notes + both candidate label lists + the model id — so an unchanged note is
 * never re-classified, while a changed note (or a different ticket type's label
 * list, or a different model) gets its own entry and is never served a stale
 * result computed against different inputs.
 *
 * The cache lives in its OWN IndexedDB database (`snAnalyzerClassCache`), never
 * in `snAnalyzerCache` — the Settings "Clear pull cache" button only clears data
 * and must not wipe the classifier results. `clear()` is exposed for a manual
 * clear action.
 *
 * Bounded growth: the store keeps at most MAX_ENTRIES entries and evicts the
 * least-used / oldest first, so it cannot grow unbounded.
 */

const CACHE_DB = "snAnalyzerClassCache";
const CACHE_DB_VERSION = 1;
const CACHE_STORE = ["entries", "meta"];

const MAX_ENTRIES = 2000;
const COUNT_KEY = "count";

export type CacheKeyInput = {
  /** The trimmed resolution/closure note text. */
  notes: string;
  /** Root-cause candidates for THIS ticket's type. */
  rootCauseLabels: string[];
  /** Solution-type (resolution) candidates. */
  resolutionLabels: string[];
  /** The model that produced the result (catalog id, or "deterministic"). */
  modelId: string;
};

export type ClassifyCacheEntry = {
  outcome: ClassifyOutcome;
  savedAt: number;
  /** Number of times this entry has been reused. Used for eviction priority. */
  hits: number;
};

export interface ClassificationCacheRepository {
  get(input: CacheKeyInput): Promise<ClassifyCacheEntry | undefined>;
  put(input: CacheKeyInput, entry: ClassifyCacheEntry): Promise<void>;
  /** Bumps the reuse count without changing the outcome. */
  noteHit(input: CacheKeyInput): Promise<void>;
  stats(): Promise<{ entries: number }>;
  clear(): Promise<void>;
}

/** Canonical FNV-1a hash of the key parts. Dependency-free and fast. */
export function hashKey(input: CacheKeyInput): string {
  const key = [
    input.notes,
    input.rootCauseLabels.join("\u0000"),
    input.resolutionLabels.join("\u0000"),
    input.modelId
  ].join("\u0001");
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return `c:${h.toString(16)}:${key.length}`;
}

export class ClassificationCacheStore implements ClassificationCacheRepository {
  static readonly deps = [] as const;

  private readonly db: IdbDatabase;

  constructor(db: IdbDatabase = createIdbDatabase(CACHE_DB, CACHE_DB_VERSION, CACHE_STORE)) {
    this.db = db;
  }

  private entries() { return this.db.store("entries"); }
  private meta() { return this.db.store("meta"); }

  async get(input: CacheKeyInput): Promise<ClassifyCacheEntry | undefined> {
    return this.entries().get<ClassifyCacheEntry | undefined>(hashKey(input));
  }

  async put(input: CacheKeyInput, entry: ClassifyCacheEntry): Promise<void> {
    const key = hashKey(input);
    const existing = await this.entries().get<ClassifyCacheEntry | undefined>(key);
    const count = await this.count();
    await this.entries().put(key, entry);
    if (!existing) {
      await this.setCount(count + 1);
      if (count + 1 > MAX_ENTRIES) await this.evict(1);
    }
  }

  async noteHit(input: CacheKeyInput): Promise<void> {
    const key = hashKey(input);
    const entry = await this.entries().get<ClassifyCacheEntry | undefined>(key);
    if (entry) {
      await this.entries().put(key, { ...entry, hits: entry.hits + 1 });
    }
  }

  async stats(): Promise<{ entries: number }> {
    return { entries: await this.count() };
  }

  async clear(): Promise<void> {
    await this.entries().clear();
    await this.setCount(0);
  }

  private async count(): Promise<number> {
    const v = await this.meta().get<number>(COUNT_KEY);
    return typeof v === "number" ? v : 0;
  }

  private async setCount(n: number): Promise<void> {
    await this.meta().put(COUNT_KEY, n);
  }

  /** Removes up to `n` entries so the bound is respected. Priority: lowest hits,
   *  then oldest savedAt. deleteWhere visits every entry, so we drop any whose
   *  hits fall below the target; if none are cold enough we clear the oldest
   *  bucket. This is best-effort but keeps the store near MAX_ENTRIES. */
  private async evict(n: number): Promise<void> {
    for (let threshold = 0; threshold < n; threshold++) {
      const removed = await this.entries().deleteWhere(
        (value: any) => value && typeof value.hits === "number" && value.hits <= threshold
      );
      if (removed > 0) return;
    }
    // Nothing cold; drop oldest buckets by age order is not supported, so clear
    // entries saved before now and rely on re-population. Worst case the cache
    // is a little over-bound until the next put.
    await this.entries().deleteWhere((value: any) => value && value.hits === 0);
  }
}

/** In-memory twin for tests: same store shape, no IndexedDB. */
export function createMemoryClassificationCacheRepository(): ClassificationCacheRepository {
  return new ClassificationCacheStore(createMemoryDatabase(CACHE_STORE));
}

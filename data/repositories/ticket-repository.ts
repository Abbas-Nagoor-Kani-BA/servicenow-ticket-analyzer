import { IDB, SN_REMOTE } from "../../di/tokens.ts";
import type { IdbDatabase } from "../idb.ts";
import type { SnRemote, TicketRecord } from "../datasource/sn-remote.ts";

export type QueryCacheEntry = {
  at: number;
  table: string;
  query: string;
  records: TicketRecord[];
};

export type TicketListRequest = {
  table: string;
  encodedQuery: string;
  fields: string[];
  signal?: AbortSignal;
  onProgress?: (p: { fetched: number; total: number }) => void;
};

export type TicketListResult = {
  records: TicketRecord[];
  source: "cache" | "remote";
  cachedAt: number | null;
};

export interface TicketRepository {
  count(table: string, encodedQuery: string): Promise<number>;
  list(req: TicketListRequest): Promise<TicketListResult>;
  /** Query cache freshness window in minutes. `0` disables caching. */
  setQueryTtlMinutes(minutes: number): void;
}

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const TIMELINE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const QUERY_STORE = "queries";
const TIMELINE_STORE = "timelines";

/** Stable hash of a table + encoded query, used as the cache key. */
export function queryKey(table: string, encodedQuery: string): string {
  const s = `${table}\n${encodedQuery}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 + c, 0x85ebca6b);
  }
  return (
    ("0000000" + (h1 >>> 0).toString(16)).slice(-8) +
    "-" +
    ("0000000" + (h2 >>> 0).toString(16)).slice(-8)
  );
}

/**
 * True when a cached query can be reused. At exactly the TTL the entry is
 * stale: `now - at < ttl` is deliberately strict.
 */
export function isFreshQuery(
  entry: QueryCacheEntry | undefined | null,
  now = Date.now(),
  ttlMs: number = DEFAULT_TTL_MS
): boolean {
  return !!entry && typeof entry.at === "number" && Array.isArray(entry.records) && now - entry.at < ttlMs;
}

/**
 * Ticket reads with the cache policy built in.
 *
 * Freshness lives here rather than in the pull service: a caller asking for
 * tickets should not have to know that a cache exists, only that it got
 * records and whether they came from the network.
 */
export class CachedTicketRepository implements TicketRepository {
  static readonly deps = [SN_REMOTE, IDB] as const;

  private readonly remote: SnRemote;
  private readonly db: IdbDatabase;
  private ttlMs: number;

  constructor(remote: SnRemote, db: IdbDatabase, ttlMs: number = DEFAULT_TTL_MS) {
    this.remote = remote;
    this.db = db;
    this.ttlMs = ttlMs;
  }

  /** Query cache freshness window. `0` disables caching entirely. */
  setQueryTtlMinutes(minutes: number): void {
    const n = Math.round(Number(minutes));
    if (Number.isFinite(n) && n >= 0) this.ttlMs = n * 60 * 1000;
  }

  getQueryTtlMs(): number {
    return this.ttlMs;
  }

  count(table: string, encodedQuery: string): Promise<number> {
    return this.remote.count(table, encodedQuery);
  }

  async list(req: TicketListRequest): Promise<TicketListResult> {
    const key = queryKey(req.table, req.encodedQuery);
    const store = this.db.store(QUERY_STORE);
    const hit = await store.get<QueryCacheEntry>(key).catch(() => undefined);

    if (isFreshQuery(hit, Date.now(), this.ttlMs)) {
      return { records: (hit as QueryCacheEntry).records, source: "cache", cachedAt: (hit as QueryCacheEntry).at };
    }

    const records = await this.remote.fetchAllRecords(
      req.table,
      req.encodedQuery,
      req.fields,
      req.onProgress,
      req.signal
    );

    await store
      .put(key, { at: Date.now(), table: req.table, query: req.encodedQuery, records })
      .catch(() => undefined);
    await this.purgeExpired().catch(() => undefined);

    return { records, source: "remote", cachedAt: null };
  }

  async purgeExpired(now = Date.now()): Promise<void> {
    const cutoff = now - this.ttlMs;
    await this.db.store(QUERY_STORE).deleteWhere((v) => !(v?.at >= cutoff));
    await this.db.store(TIMELINE_STORE).deleteWhere((v) => !(v?.at >= now - TIMELINE_RETENTION_MS));
  }
}

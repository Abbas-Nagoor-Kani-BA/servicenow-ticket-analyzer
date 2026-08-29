import { IDB, SN_REMOTE } from "../../di/tokens.ts";
import type { IdbDatabase } from "../idb.ts";
import type { SnRemote, TimelineEvent } from "../datasource/sn-remote.ts";

export type TimelineCacheEntry = {
  at: number;
  updatedAt: string;
  events: TimelineEvent[];
};

export type TimelineTicket = {
  sysId: string;
  updatedOn: string;
};

export type TimelineRequest = {
  table: string;
  tickets: TimelineTicket[];
  signal?: AbortSignal;
  onProgress?: (p: { ticketsDone: number; total: number }) => void;
};

export type TimelineResult = {
  /** Events keyed by sys_id. Tickets with no events anywhere are absent. */
  events: Map<string, TimelineEvent[]>;
  /** Tickets served from cache without a request. */
  reused: number;
  /** Tickets that required a request. */
  fetched: number;
};

export interface TimelineRepository {
  getMany(req: TimelineRequest): Promise<TimelineResult>;
}

/**
 * True when the cached copy is missing or older than the ticket itself.
 *
 * A ticket with no `sys_updated_on` is treated as fresh: without a watermark
 * there is nothing to compare, and re-fetching every such ticket on every run
 * would defeat the cache.
 */
export function timelineNeedsFetch(entry: TimelineCacheEntry | undefined, ticketUpdatedOn: string): boolean {
  if (!entry || !Array.isArray(entry.events)) return true;
  if (!ticketUpdatedOn) return false;
  return String(ticketUpdatedOn) > String(entry.updatedAt || "");
}

const TIMELINE_STORE = "timelines";

/**
 * Per-ticket activity reads with the cache policy built in.
 *
 * Phase 2 is one request per ticket with no batching, so the cache is what
 * makes re-runs survivable; freshness therefore belongs here, not in the
 * caller.
 */
export class CachedTimelineRepository implements TimelineRepository {
  static readonly deps = [SN_REMOTE, IDB] as const;

  private readonly remote: SnRemote;
  private readonly db: IdbDatabase;

  constructor(remote: SnRemote, db: IdbDatabase) {
    this.remote = remote;
    this.db = db;
  }

  async getMany(req: TimelineRequest): Promise<TimelineResult> {
    const store = this.db.store(TIMELINE_STORE);
    const byTicket = new Map<string, TimelineEvent[]>();
    const needFetch: TimelineTicket[] = [];
    let reused = 0;

    for (const ticket of req.tickets) {
      const key = `${req.table}:${ticket.sysId}`;
      const entry = await store.get<TimelineCacheEntry>(key).catch(() => undefined);
      if (!timelineNeedsFetch(entry, ticket.updatedOn)) {
        reused++;
        if (entry && entry.events.length) byTicket.set(ticket.sysId, entry.events);
      } else {
        needFetch.push(ticket);
      }
    }

    if (needFetch.length) {
      const fetched = await this.remote.fetchTimelineEvents(
        needFetch.map((t) => t.sysId),
        [],
        req.onProgress,
        req.signal,
        req.table
      );
      for (const ticket of needFetch) {
        const events = fetched[ticket.sysId] || [];
        if (events.length) byTicket.set(ticket.sysId, events);
        await store
          .put(`${req.table}:${ticket.sysId}`, {
            at: Date.now(),
            updatedAt: ticket.updatedOn || "",
            events
          })
          .catch(() => undefined);
      }
    }

    return { events: byTicket, reused, fetched: needFetch.length };
  }
}

import { ServiceNowClient } from "../../lib/servicenow.ts";

export type TicketRecord = Record<string, any>;
export type TimelineEvent = Record<string, any>;

export type FetchProgress = { fetched: number; total: number };
export type TimelineProgress = { ticketsDone: number; total: number };

/**
 * Remote ServiceNow data access. The only place that knows about the Table API
 * and the activity feed.
 */
export interface SnRemote {
  count(table: string, encodedQuery: string): Promise<number>;
  fetchAllRecords(
    table: string,
    encodedQuery: string,
    fields: string[],
    onProgress?: (p: FetchProgress) => void,
    signal?: AbortSignal,
    expectedTotal?: number
  ): Promise<TicketRecord[]>;
  fetchTimelineEvents(
    sysIds: string[],
    fieldNames: string[],
    onProgress?: (p: TimelineProgress) => void,
    signal?: AbortSignal,
    tableName?: string
  ): Promise<Record<string, TimelineEvent[]>>;
}

/** Structural type for the still-Javascript ServiceNowClient. */
export type ServiceNowClientLike = {
  count(table: string, encodedQuery: string): Promise<number>;
  fetchAllRecords(
    table: string,
    encodedQuery: string,
    fields: string[],
    onProgress?: (p: FetchProgress) => void,
    signal?: AbortSignal,
    expectedTotal?: number
  ): Promise<TicketRecord[]>;
  fetchTimelineEvents(
    sysIds: string[],
    fieldNames: string[],
    onProgress?: (p: TimelineProgress) => void,
    signal?: AbortSignal,
    tableName?: string
  ): Promise<Record<string, TimelineEvent[]>>;
};

export class ServiceNowRemote implements SnRemote {
  private readonly client: ServiceNowClientLike;

  constructor(client: ServiceNowClientLike) {
    this.client = client;
  }

  count(table: string, encodedQuery: string): Promise<number> {
    return this.client.count(table, encodedQuery);
  }

  fetchAllRecords(
    table: string,
    encodedQuery: string,
    fields: string[],
    onProgress?: (p: FetchProgress) => void,
    signal?: AbortSignal,
    expectedTotal = 0
  ): Promise<TicketRecord[]> {
    return this.client.fetchAllRecords(table, encodedQuery, fields, onProgress, signal, expectedTotal);
  }

  fetchTimelineEvents(
    sysIds: string[],
    fieldNames: string[],
    onProgress?: (p: TimelineProgress) => void,
    signal?: AbortSignal,
    tableName = "incident"
  ): Promise<Record<string, TimelineEvent[]>> {
    return this.client.fetchTimelineEvents(sysIds, fieldNames, onProgress, signal, tableName);
  }
}

export type ClientOptions = {
  pageSize?: number;
  debugResponses?: boolean;
  onDiagnostic?: (d: Record<string, any>) => void;
};

export function createServiceNowRemote(instanceUrl: string, transport: any, options: ClientOptions = {}): SnRemote {
  const client = new ServiceNowClient(instanceUrl, {
    transport,
    onDiagnostic: options.onDiagnostic
  }) as unknown as ServiceNowClientLike;
  if (options.pageSize !== undefined) (client as any).pageSize = options.pageSize;
  if (options.debugResponses !== undefined) (client as any).debugResponses = options.debugResponses;
  return new ServiceNowRemote(client);
}

/** In-memory `SnRemote` for tests: scripted responses, recorded calls. */
export class FakeSnRemote implements SnRemote {
  readonly calls: { method: string; args: unknown[] }[] = [];
  counts: Record<string, number> = {};
  records: Record<string, TicketRecord[]> = {};
  timelines: Record<string, TimelineEvent[]> = {};

  async count(table: string, encodedQuery: string): Promise<number> {
    this.calls.push({ method: "count", args: [table, encodedQuery] });
    return this.counts[`${table}|${encodedQuery}`] ?? 0;
  }

  async fetchAllRecords(
    table: string,
    encodedQuery: string,
    fields: string[],
    onProgress?: (p: FetchProgress) => void
  ): Promise<TicketRecord[]> {
    this.calls.push({ method: "fetchAllRecords", args: [table, encodedQuery, fields] });
    const records = this.records[`${table}|${encodedQuery}`] ?? [];
    onProgress?.({ fetched: records.length, total: records.length });
    return records;
  }

  async fetchTimelineEvents(
    sysIds: string[],
    fieldNames: string[],
    onProgress?: (p: TimelineProgress) => void
  ): Promise<Record<string, TimelineEvent[]>> {
    this.calls.push({ method: "fetchTimelineEvents", args: [sysIds, fieldNames] });
    const out: Record<string, TimelineEvent[]> = {};
    let done = 0;
    for (const id of sysIds) {
      if (this.timelines[id]) out[id] = this.timelines[id];
      done++;
      onProgress?.({ ticketsDone: done, total: sysIds.length });
    }
    return out;
  }
}

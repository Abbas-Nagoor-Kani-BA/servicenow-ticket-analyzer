import * as Analysis from "../core/phase2.ts";

export type TransportResult = {
  ok: boolean;
  status?: number;
  text?: string;
  headers?: Record<string, string>;
  via?: string;
  hadToken?: boolean;
  tokenSource?: string | null;
  error?: string;
};

export type TransportLike = (url: string, opts?: unknown) => Promise<TransportResult>;

export type Diagnostic = { [k: string]: unknown };

type ListHistoryPayload = { entries: unknown[] };

class ServiceNowClient {
  baseUrl: string;
  transport: TransportLike | null;
  onDiagnostic: ((d: Diagnostic) => void) | null;
  pageSize = 1000;
  maxRetries = 4;
  debugResponses = false;
  activitySource = "";

  constructor(instanceUrl: string, options: { transport?: TransportLike | null; onDiagnostic?: ((d: Diagnostic) => void) | null } = {}) {
    this.baseUrl = instanceUrl.replace(/\/+$/, "");
    this.transport = options.transport || null;
    this.onDiagnostic = options.onDiagnostic || null;
  }

  #emit(diag: Diagnostic): void {
    if (!this.onDiagnostic) return;
    try {
      this.onDiagnostic(diag);
    } catch { /* diagnostics must never break the request */ }
  }

  async #sleep(ms: number): Promise<void> {
    await new Promise(r => setTimeout(r, ms));
  }

  async #request(path: string, params: Record<string, unknown> = {}): Promise<Response> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const target = url.toString();
    const started = Date.now();
    const q = String(params.sysparm_query || "");
    const shortQuery = q.length > 100 ? q.slice(0, 100) + "…" : q;
    const emit = (extra: Diagnostic) => {
      if (!this.onDiagnostic) return;
      this.#emit({
        status: null, via: null, hadToken: null, tokenSource: null,
        path, query: shortQuery, ms: Date.now() - started,
        ...extra
      });
    };
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        let res: Response;
        if (this.transport) {
          const raw = await this.transport(target);
          if (!raw || raw.ok === false) throw new TypeError(raw?.error || "Transport failed");
          res = new Response(raw.text || "", { status: raw.status, headers: raw.headers || {} });
          res.snVia = raw.via;
          res.snHadToken = raw.hadToken;
          res.snTokenSource = raw.tokenSource || null;
        } else {
          res = await fetch(target, { method: "GET", credentials: "include", headers: { "Accept": "application/json" } });
          res.snVia = "direct";
          res.snHadToken = null;
        }
        if (res.status === 401 || res.status === 403) {
          emit({ kind: "err", status: res.status });
          throw new Error(
            `Auth error ${res.status} (${res.snVia}, token ${res.snHadToken ? "sent" : "MISSING"}): refresh your ServiceNow browser tab and confirm you are logged in, then press Connect again`
          );
        }
        if (res.status === 429 || res.status >= 500) {
          const rateLimited = res.status === 429;
          lastError = rateLimited
            ? new Error("Rate limited by ServiceNow (HTTP 429)")
            : new Error(`Server ${res.status}, retrying (${attempt + 1}/${this.maxRetries})`);
          emit({ kind: "warn", status: res.status, attempt: attempt + 1, rateLimited });
          await this.#sleep(1500 * Math.pow(2, attempt));
          continue;
        }
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          emit({ kind: "err", status: res.status });
          throw new Error(`HTTP ${res.status} on ${path}: ${body.slice(0, 300)}`);
        }
        emit({ kind: "ok", status: res.status, via: res.snVia, hadToken: res.snHadToken, tokenSource: res.snTokenSource });
        return res;
      } catch (err) {
        if (err instanceof TypeError) {
          lastError = err;
          emit({ kind: "warn", status: 0, attempt: attempt + 1, netError: String((err as Error).message || err) });
          await this.#sleep(1500 * Math.pow(2, attempt));
        } else {
          if (!(err instanceof Error) || !/^Auth error|^HTTP /.test(err.message)) emit({ kind: "err", status: 0 });
          throw err;
        }
      }
    }
    emit({ kind: "err", status: 0, retriesExhausted: true });
    if (lastError?.message?.startsWith("Rate limited by ServiceNow")) {
      throw new Error("Rate limited by ServiceNow (HTTP 429) — wait a few minutes before running again");
    }
    throw lastError || new Error("Request failed after retries");
  }

  async count(table: string, encodedQuery: string): Promise<number> {
    const res = await this.#request(`/api/now/table/${table}`, {
      sysparm_query: encodedQuery,
      sysparm_limit: 1,
      sysparm_fields: "sys_id",
      sysparm_display_count: "true"
    });
    const total = parseInt(res.headers.get("x-total-count") || "0", 10);
    if (!Number.isFinite(total)) throw new Error("Could not read record count");
    return total;
  }

  async fetchAllRecords(
    table: string,
    encodedQuery: string,
    fields: string[],
    onProgress?: (p: { fetched: number }) => void,
    signal?: AbortSignal,
    expectedTotal = 0
  ): Promise<Record<string, any>[]> {
    const rows: Record<string, any>[] = [];
    let offset = 0;
    let clampedWarned = false;
    const maxPages = expectedTotal > 0 ? expectedTotal + 10 : 2000;
    let pages = 0;
    while (true) {
      if (++pages > maxPages) {
        throw new Error(`Pagination did not converge after ${maxPages} pages (${rows.length}/${expectedTotal || "?"} rows) — narrow the filter or check the instance page-size cap`);
      }
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const res = await this.#request(`/api/now/table/${table}`, {
        sysparm_query: encodedQuery,
        sysparm_limit: this.pageSize,
        sysparm_offset: offset,
        sysparm_fields: fields.join(","),
        sysparm_display_value: "all"
      });
      const data = await res.json();
      const batch = (data.result || []).map((r: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(r)) {
          if (v && typeof v === "object") {
            out[k] = { display_value: (v as { display_value?: string }).display_value ?? "", value: (v as { value?: string }).value ?? "" };
          } else {
            out[k] = v;
          }
        }
        return out;
      }) as Record<string, any>[];
      if (!batch.length) break;
      rows.push(...batch);
      offset += batch.length;
      onProgress?.({ fetched: rows.length });
      if (expectedTotal > 0) {
        if (rows.length >= expectedTotal) break;
        if (batch.length < this.pageSize && !clampedWarned) {
          clampedWarned = true;
          this.#emit({
            kind: "warn",
            note: `page returned ${batch.length} rows but ${this.pageSize} were requested — instance may cap page size; continuing with smaller pages`
          });
        }
        continue;
      }
      if (batch.length < this.pageSize) break;
    }
    return rows;
  }

  async fetchTimelineEvents(
    sysIds: string[],
    fieldNames: string[],
    onProgress?: (p: { ticketsDone: number; ticketsTotal: number }) => void,
    signal?: AbortSignal,
    tableName = "incident"
  ): Promise<Record<string, { field: string; oldValue: string; newValue: string; at: string }[]>> {
    if (!sysIds.length) return {};
    return this.#fetchViaActivity(sysIds, fieldNames, onProgress, signal, tableName);
  }

  async #fetchViaActivity(
    sysIds: string[],
    fieldNames: string[],
    onProgress?: (p: { ticketsDone: number; ticketsTotal: number }) => void,
    signal?: AbortSignal,
    tableName = "incident"
  ): Promise<Record<string, { field: string; oldValue: string; newValue: string; at: string }[]>> {
    const A = Analysis;
    if (!A?.extractEventsFromListHistory && !A?.extractEventsFromActivity) {
      throw new Error("Activity parser module not loaded");
    }
    const wanted = new Set(fieldNames);
    let preloaded: Record<string, ListHistoryPayload> | null = null;
    if (!this.activitySource) {
      try {
        const probe = await this.#fetchListHistory(tableName, sysIds[0]);
        if (Array.isArray(probe?.entries)) {
          this.activitySource = "list-history";
          preloaded = { [sysIds[0]]: probe };
        } else {
          this.activitySource = "stream";
        }
      } catch (err) {
        this.#emit({
          kind: "warn",
          note: `list_history.do unavailable (${String((err as Error).message).slice(0, 80)}) - using /api/now/v1/activity/stream`
        });
        this.activitySource = "stream";
      }
    }
    if (this.activitySource === "list-history") {
      try {
        return await this.#runListHistory(sysIds, wanted, onProgress, signal, tableName, preloaded);
      } catch (err) {
        if (signal?.aborted) throw err;
        this.#emit({
          kind: "warn",
          note: `list_history.do failed mid-run (${String((err as Error).message).slice(0, 80)}) - switching to activity/stream`
        });
        this.activitySource = "stream";
      }
    }
    return await this.#runStream(sysIds, wanted, onProgress, signal, tableName);
  }

  async #runListHistory(
    sysIds: string[],
    wanted: Set<string>,
    onProgress?: (p: { ticketsDone: number; ticketsTotal: number }) => void,
    signal?: AbortSignal,
    tableName = "incident",
    preloaded: Record<string, ListHistoryPayload> | null = null
  ): Promise<Record<string, { field: string; oldValue: string; newValue: string; at: string }[]>> {
    const byTicket: Record<string, { field: string; oldValue: string; newValue: string; at: string }[]> = {};
    const filterWanted = wanted.size > 0;
    for (const [idx, sysId] of sysIds.entries()) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const payload = preloaded?.[sysId] || await this.#fetchListHistory(tableName, sysId);
      let events = Analysis.extractEventsFromListHistory(payload)[sysId] || [];
      if (filterWanted) events = events.filter(e => wanted.has(e.field));
      if (events.length) byTicket[sysId] = events;
      onProgress?.({ ticketsDone: idx + 1, ticketsTotal: sysIds.length });
    }
    if (!Object.keys(byTicket).length && sysIds.length) {
      this.#emit({
        kind: "warn",
        note: "activity feed yielded no field changes; timelines will stay empty"
      });
    }
    return byTicket;
  }

  async #fetchListHistory(table: string, sysId: string): Promise<ListHistoryPayload> {
    const res = await this.#request("/list_history.do", {
      sysparm_type: "list_history",
      table,
      action: "get_new_entries",
      sysparm_silent_request: "true",
      sysparm_auto_request: "true",
      include_attachments: "",
      sys_id: sysId
    });
    const text = await res.text();
    let json: ListHistoryPayload;
    try {
      json = JSON.parse(text) as ListHistoryPayload;
    } catch {
      throw new Error("non-JSON response");
    }
    if (!json || !Array.isArray(json.entries)) throw new Error("missing entries array");
    return json;
  }

  async #runStream(
    sysIds: string[],
    wanted: Set<string>,
    onProgress?: (p: { ticketsDone: number; ticketsTotal: number }) => void,
    signal?: AbortSignal,
    tableName = "incident"
  ): Promise<Record<string, { field: string; oldValue: string; newValue: string; at: string }[]>> {
    const parse = Analysis.extractEventsFromActivity;
    const byTicket: Record<string, { field: string; oldValue: string; newValue: string; at: string }[]> = {};
    const filterWanted = wanted.size > 0;
    for (const [idx, sysId] of sysIds.entries()) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      let entries: unknown[];
      try {
        entries = await this.#fetchActivityEntries(tableName, sysId);
      } catch (err) {
        throw new Error(
          `Activity stream unavailable (${(err as Error).message}) - no compatible activity feed endpoint on this release`
        );
      }
      let events = parse(entries) || [];
      if (filterWanted) events = events.filter(e => wanted.has(e.field));
      if (events.length) byTicket[sysId] = events;
      onProgress?.({ ticketsDone: idx + 1, ticketsTotal: sysIds.length });
    }
    if (!Object.keys(byTicket).length && sysIds.length) {
      this.#emit({
        kind: "warn",
        note: "activity feed yielded no recognizable field changes; timelines will stay empty"
      });
    }
    return byTicket;
  }

  async #fetchActivityEntries(table: string, sysId: string): Promise<unknown[]> {
    const entries: unknown[] = [];
    for (let page = 0; page < 5; page++) {
      const res = await this.#request("/api/now/v1/activity/stream", {
        table,
        sys_id: sysId,
        sysparm_limit: 200,
        sysparm_offset: entries.length
      });
      const data = await res.json();
      const batch =
        data?.result?.entries ||
        data?.entries ||
        (Array.isArray(data?.result) ? data.result : []);
      if (!Array.isArray(batch) || !batch.length) break;
      entries.push(...batch);
      if (batch.length < 200) break;
    }
    return entries;
  }
}

export { ServiceNowClient };
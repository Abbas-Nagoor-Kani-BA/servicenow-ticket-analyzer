import { MSG } from "../lib/keys.ts";
import { broadcast } from "../lib/storage.ts";
import * as Analysis from "../core/phase2.ts";
import { createSmartTransport } from "../data/datasource/sn-transport.ts";
import { createServiceNowRemote } from "../data/datasource/sn-remote.ts";
import { PULL_SERVICE, CONNECTION_SERVICE, SETTINGS_REPO, SN_REMOTE_FACTORY } from "../di/tokens.ts";
import { createBackgroundContainer } from "../di/register-background.ts";
import { ConnectionService } from "../services/connection-service.ts";
import { PullService } from "../services/pull-service.ts";
import type { MsgRun, MsgCount } from "../types/global.d.ts";

type WorkerRequest = MsgRun | MsgCount | { type: typeof MSG.ping };
type SendResponse = (response: unknown) => void;

/*
 * Service worker entry point: a message router, nothing more.
 *
 * The pull pipeline lives in services/pull-service.ts and all data access in
 * data/repositories/. This file binds them to the extension's messaging API and
 * to the ServiceNow transport, which only exists here.
 */

globalThis.Analysis = Analysis;

const container = createBackgroundContainer();

container.registerValue(SN_REMOTE_FACTORY, async (instanceUrl, onDiagnostic) => {
  const settings = await container.resolve(SETTINGS_REPO).load();
  const params = settings?.params || {};
  const pageSize = clampNum(params.tablePageSize, 100, 5e3);
  return createServiceNowRemote(instanceUrl, createSmartTransport(), {
    pageSize: pageSize || undefined,
    debugResponses: !!params.debugResponses,
    onDiagnostic
  });
});

container.registerClass(PULL_SERVICE, PullService, { singleton: true });
container.registerClass(CONNECTION_SERVICE, ConnectionService, { singleton: true });

let running = false;

function clampNum(value: unknown, lo: number, hi: number): number | null {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
}

function progress(stage: string, detail: string, extra: Record<string, unknown> = {}) {
  broadcast({ type: MSG.progress, stage, detail, ...extra });
}

function onDiagnostic(d: any) {
  const ms = typeof d.ms === "number" ? ` · ${d.ms}ms` : "";
  if (d.kind === "warn") {
    if (d.note) {
      progress("diag", `${d.path || "audit"} ⚠ ${d.note}`);
      return;
    }
    if (d.rateLimited) {
      progress("diag", `⚠ RATE LIMITED — ServiceNow is throttling requests; auto-retrying (${d.attempt}/${4}). If this repeats, reduce tickets per run or ask your admin about rate-limit rules.`);
      return;
    }
    const why = d.netError ? `network: ${d.netError}` : `server ${d.status}`;
    progress("diag", `${d.path} ✕ ${why} · retrying (${d.attempt}/${4})${ms} · q=${d.query || ""}`);
    return;
  }
  if (d.kind === "err") {
    progress("diag", `${d.path} → HTTP ${d.status}${ms}${d.retriesExhausted ? " · retries exhausted" : ""} · q=${d.query || ""}`);
    return;
  }
  const token = d.hadToken === null || d.hadToken === void 0 ? "" : ` · token=${d.hadToken ? d.tokenSource || "sent" : "MISSING"}`;
  const rows = d.bodyRows !== void 0 && d.bodyRows !== null ? ` · result=${d.bodyRows}` : "";
  const preview = d.bodyPreview ? ` · body=${d.bodyPreview}` : "";
  progress("diag", `${d.path} → ${d.status}${ms} · via=${d.via}${token}${rows} · q=${d.query || ""}${preview}`);
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
});

chrome.runtime.onMessage.addListener((msg: WorkerRequest, _sender: unknown, sendResponse: SendResponse) => {
  if (msg.type === MSG.ping) {
    sendResponse({ ok: true, running });
    return false;
  }

  if (msg.type === MSG.count) {
    container
      .resolve(CONNECTION_SERVICE)
      .count({ instanceUrl: msg.instanceUrl, groups: msg.groups, filters: msg.filters, filterSets: msg.filterSets, onDiagnostic })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => {
        progress("diag", `${MSG.count} failed: ${err.message}`);
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (msg.type === MSG.run) {
    if (running) {
      sendResponse({ ok: false, started: false, error: "A run is already in progress" });
      return false;
    }
    running = true;
    const abort = new AbortController();

    // Deliberately not awaited: a pull runs for minutes, and holding the
    // response channel open that long risks it being torn down. Progress
    // reaches the panel through broadcast, not through this reply.
    container
      .resolve(PULL_SERVICE)
      .run({
        instanceUrl: msg.instanceUrl,
        groups: msg.groups,
        filterSets: msg.filterSets,
        filters: msg.filters,
        fields: msg.fields,
        includeChangeSummary: msg.includeChangeSummary,
        signal: abort.signal,
        onProgress: progress,
        onDiagnostic
      })
      .catch((err) => {
        progress("error", err.message);
      })
      .finally(() => {
        running = false;
      });

    sendResponse({ ok: true, started: true });
    return true;
  }

  return false;
});
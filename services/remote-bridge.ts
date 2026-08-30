import { MSG } from "../lib/keys.ts";
import { broadcast } from "../lib/storage.js";
import type { MsgCount, MsgProgress, MsgRun } from "../types/global.d.ts";

/*
 * Page-side proxy for the service worker's message API.
 *
 * Extension pages cannot construct the remote-capable repositories (they need
 * the CSRF token and the content-script relay, which only exist in the worker).
 * This bridge gives pages the typed surface they DO need: preview, run, the
 * progress feed, and the data-changed broadcast. It owns the lastError check in
 * one place instead of each bootstrap hand-rolling chrome.runtime.sendMessage.
 */

export type CountReply = {
  ok: boolean;
  total?: number;
  encodedQuery?: string;
  limit?: number;
  error?: string;
};

export type RunReply = {
  ok: boolean;
  started?: boolean;
  error?: string;
};

export type BridgeMsg = {
  type?: unknown;
  [key: string]: unknown;
};

export class RemoteBridge {
  static readonly deps = [] as const;

  /**
   * Sends a message to the service worker and resolves with its reply.
   * Uses the callback form so `chrome.runtime.lastError` is checked in one
   * place; pages that awaited a raw sendMessage would miss it.
   */
  private request(msg: MsgCount | MsgRun): Promise<unknown> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (res: unknown) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(res);
      });
    });
  }

  /** Preview count for the panel's Run button. */
  preview(req: Omit<MsgCount, "type">): Promise<CountReply> {
    return this.request({ type: MSG.count, ...req }) as Promise<CountReply>;
  }

  /** Kicks off a pull in the worker. Fire-and-forget from the page's side. */
  run(req: Omit<MsgRun, "type">): Promise<RunReply> {
    return this.request({ type: MSG.run, ...req }) as Promise<RunReply>;
  }

  /** Broadcasts that the dataset changed (e.g. a clear-cache, an export view). */
  notifyDataUpdated(): void {
    broadcast({ type: MSG.dataUpdated });
  }

  /**
   * Subscribes to worker progress broadcasts. Returns an unsubscribe fn so
   * repeated init cannot double-register the same page's listener.
   */
  onProgress(handler: (msg: MsgProgress) => void): () => void {
    const listener = (msg: BridgeMsg): void => {
      if (msg?.type !== MSG.progress) return;
      handler(msg as MsgProgress);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }
}
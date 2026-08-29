import { Container } from "./container.ts";
import { registerCoreRepositories } from "./register-core.ts";
import { IDB, TICKET_REPO, TIMELINE_REPO } from "./tokens.ts";

import { createIdbDatabase } from "../data/idb.ts";
import { CachedTicketRepository } from "../data/repositories/ticket-repository.ts";
import { CachedTimelineRepository } from "../data/repositories/timeline-repository.ts";

/**
 * Registers the repositories that need IndexedDB plus the ServiceNow remote.
 *
 * Service-worker only: they depend on the CSRF token and the content-script
 * relay, neither of which exists in an extension page. `SN_REMOTE` is
 * deliberately left unregistered here — it is per-run, because it is bound to
 * one instance URL — so callers register it on a `child()` container.
 */
export function registerRemoteRepositories(c: Container): Container {
  if (!c.has(IDB)) {
    c.registerValue(IDB, createIdbDatabase());
  }
  c.registerClass(TICKET_REPO, CachedTicketRepository, { singleton: true });
  c.registerClass(TIMELINE_REPO, CachedTimelineRepository, { singleton: true });
  return c;
}

export function createBackgroundContainer(): Container {
  return registerRemoteRepositories(registerCoreRepositories(new Container()));
}

import { Container } from "./container.ts";
import { registerCoreRepositories } from "./register-core.ts";
import { IDB, RUN_SCOPE_FACTORY, SN_REMOTE, SN_REMOTE_FACTORY, TICKET_REPO, TIMELINE_REPO } from "./tokens.ts";

import { createIdbDatabase } from "../data/idb.ts";
import { CachedTicketRepository } from "../data/repositories/ticket-repository.ts";
import { CachedTimelineRepository } from "../data/repositories/timeline-repository.ts";

/**
 * Registers the repositories that need IndexedDB plus the ServiceNow remote.
 *
 * Service-worker only: they depend on the CSRF token and the content-script
 * relay, neither of which exists in an extension page.
 *
 * `SN_REMOTE` is deliberately not registered at the root — it is bound to one
 * instance URL, so it belongs to a single run. `RUN_SCOPE_FACTORY` opens that
 * per-run child and returns the repositories wired to it.
 */
export function registerRemoteRepositories(c: Container): Container {
  if (!c.has(IDB)) {
    c.registerValue(IDB, createIdbDatabase());
  }
  c.registerClass(TICKET_REPO, CachedTicketRepository, { singleton: true });
  c.registerClass(TIMELINE_REPO, CachedTimelineRepository, { singleton: true });

  if (!c.has(RUN_SCOPE_FACTORY)) {
    c.register(RUN_SCOPE_FACTORY, (container) => async (instanceUrl, onDiagnostic) => {
      const child = container.child();
      const factory = container.resolve(SN_REMOTE_FACTORY);
      child.registerValue(SN_REMOTE, await factory(instanceUrl, onDiagnostic));
      return {
        tickets: child.resolve(TICKET_REPO),
        timelines: child.resolve(TIMELINE_REPO)
      };
    });
  }

  return c;
}

export function createBackgroundContainer(): Container {
  return registerRemoteRepositories(registerCoreRepositories(new Container()));
}

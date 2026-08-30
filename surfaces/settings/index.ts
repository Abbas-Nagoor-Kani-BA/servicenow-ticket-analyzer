import { Container } from "../../di/container.ts";
import { registerCoreRepositories } from "../../di/register-core.ts";
import { MSR_LISTS_REPO, SETTINGS_REPO, REMOTE_BRIDGE } from "../../di/tokens.ts";

import { ChipList } from "../../components/chip-list.ts";
import type { MsrListsRepository } from "../../data/repositories/msr-lists-repository.ts";
import { SettingsService } from "../../services/settings-service.ts";
import { RemoteBridge } from "../../services/remote-bridge.ts";
import { MSR_DEFAULT_LISTS } from "../../core/msrchoices.ts";

/*
 * Composition root for the options page.
 *
 * Builds the container, the settings service, and every chip list the page
 * needs. The bootstrap then only moves values between those objects and the
 * plain form inputs.
 */

/** MSR option lists that are flat string arrays. */
const MSR_LIST_FIELDS: [string, string][] = [
  ["opCo", "msrOpCo"],
  ["domain", "msrDomain"],
  ["type", "msrType"],
  ["status", "msrStatus"],
  ["resolution", "msrResolution"],
  ["duplicate", "msrDuplicate"],
  ["queue", "msrQueue"],
  ["subCategory", "msrSubCategory"]
];

/** Root-cause option lists, keyed by ticket prefix. */
const MSR_RC_FIELDS: [string, string][] = [
  ["Incident", "msrRcIncident"],
  ["RFS", "msrRcRfs"],
  ["P_Ticket", "msrRcPTicket"]
];

export type SettingsWiring = {
  container: Container;
  bridge: RemoteBridge;
  settings: SettingsService;
  msrLists: MsrListsRepository;
  chips: Record<string, ChipList>;
  msrFieldIds: { lists: [string, string][]; rootCause: [string, string][] };
};

export function createSettings(): SettingsWiring {
  const container = registerCoreRepositories(new Container());
  container.registerClass(REMOTE_BRIDGE, RemoteBridge, { singleton: true });

  const $ = (id: string): HTMLElement => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`settings: missing #${id}`);
    return node;
  };

  const chip = (id: string, collapsible = true): ChipList =>
    new ChipList($(id), {}, { collapsible, placeholder: "One value per line — commas/semicolons also split" });

  const chips: Record<string, ChipList> = {
    queues: chip("queuesChips"),
    teamMembers: chip("teamMembersChips")
  };
  for (const [, id] of MSR_LIST_FIELDS) chips[id] = chip(id);
  for (const [, id] of MSR_RC_FIELDS) chips[id] = chip(id);

  return {
    container,
    bridge: container.resolve(REMOTE_BRIDGE),
    settings: new SettingsService(container.resolve(SETTINGS_REPO)),
    msrLists: container.resolve(MSR_LISTS_REPO),
    chips,
    msrFieldIds: { lists: MSR_LIST_FIELDS, rootCause: MSR_RC_FIELDS }
  };
}

export function fillMsrLists(wiring: SettingsWiring, lists: Record<string, any>): void {
  for (const [key, id] of MSR_LIST_FIELDS) {
    wiring.chips[id].setValues(lists[key] || []);
  }
  for (const [key, id] of MSR_RC_FIELDS) {
    wiring.chips[id].setValues((lists.rootCause || {})[key] || []);
  }
}

export function collectMsrLists(wiring: SettingsWiring): { version: number; lists: Record<string, any> } {
  const lists: Record<string, any> = {};
  for (const [key, id] of MSR_LIST_FIELDS) lists[key] = wiring.chips[id].getValues();
  const rootCause: Record<string, string[]> = {};
  for (const [key, id] of MSR_RC_FIELDS) rootCause[key] = wiring.chips[id].getValues();
  lists.rootCause = rootCause;
  return { version: 2, lists };
}

export { MSR_DEFAULT_LISTS };

import { Container } from "../../di/container.ts";
import { registerCoreRepositories } from "../../di/register-core.ts";
import { MSR_LISTS_REPO, SETTINGS_REPO, REMOTE_BRIDGE } from "../../di/tokens.ts";

import { ChipList } from "../../components/chip-list.ts";
import { el } from "../../components/component.ts";
import type { MsrListsRepository } from "../../data/repositories/msr-lists-repository.ts";
import { SettingsService } from "../../services/settings-service.ts";
import { RemoteBridge } from "../../services/remote-bridge.ts";
import { MSR_DEFAULT_LISTS } from "../../core/msrchoices.ts";
import { MlModelStore } from "../../data/ml-model-repository.ts";
import type { MlModelRepository } from "../../data/ml-model-repository.ts";
import { ClassificationCacheStore } from "../../data/classification-cache-repository.ts";
import type { ClassificationCacheRepository } from "../../data/classification-cache-repository.ts";

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
  mlModel: MlModelRepository;
  mlCache: ClassificationCacheRepository;
  chips: Record<string, ChipList>;
  kwChips: Record<string, ChipList>;
  kwTiles: Record<string, HTMLElement>;
  kwStack: HTMLElement | null;
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
    mlModel: new MlModelStore(),
    mlCache: new ClassificationCacheStore(),
    chips,
    kwChips: {},
    kwTiles: {},
    kwStack: document.getElementById("kwStack"),
    msrFieldIds: { lists: MSR_LIST_FIELDS, rootCause: MSR_RC_FIELDS }
  };
}

/** The classifier labels: every active root-cause category plus every active
 *  resolution label (keyword hints are keyed by label name). */
function kwLabels(lists: Record<string, any>): string[] {
  const out: string[] = [];
  const rc = ((lists.rootCause as Record<string, any>) || {});
  for (const t of ["Incident", "RFS", "P_Ticket"]) {
    for (const label of rc[t] || []) {
      if (typeof label === "string" && !out.includes(label)) out.push(label);
    }
  }
  for (const label of (lists.resolution || []) as string[]) {
    if (typeof label === "string" && !out.includes(label)) out.push(label);
  }
  return out;
}

/** Keeps the per-label keyword chips in step with the active MSR lists: creates
 *  a chip per label, drops chips whose label left the lists. */
export function rebuildKeywordChips(wiring: SettingsWiring, lists: Record<string, any>): void {
  const stack = wiring.kwStack;
  if (!stack) return;
  const wanted = new Set(kwLabels(lists));
  for (const label of wanted) {
    if (wiring.kwChips[label]) continue;
    const tile = el("div", "msrTile");
    tile.append(el("label", "block text-[11.5px] uppercase tracking-wider text-muted mt-2 mb-1.5", label));
    const body = el("div");
    tile.appendChild(body);
    stack.appendChild(tile);
    wiring.kwTiles[label] = tile;
    wiring.kwChips[label] = new ChipList(body, {}, {
      collapsible: true,
      placeholder: "One keyword per line — commas/semicolons also split"
    });
  }
  for (const label of Object.keys(wiring.kwChips)) {
    if (wanted.has(label)) continue;
    delete wiring.kwChips[label];
    const tile = wiring.kwTiles[label];
    delete wiring.kwTiles[label];
    if (tile) tile.remove();
  }
}

export function fillMsrLists(wiring: SettingsWiring, lists: Record<string, any>): void {
  rebuildKeywordChips(wiring, lists);
  for (const [key, id] of MSR_LIST_FIELDS) {
    wiring.chips[id].setValues(lists[key] || []);
  }
  for (const [key, id] of MSR_RC_FIELDS) {
    wiring.chips[id].setValues((lists.rootCause || {})[key] || []);
  }
  const hints = (lists.hints as Record<string, string[]>) || {};
  for (const label of kwLabels(lists)) {
    const chip = wiring.kwChips[label];
    if (chip) chip.setValues(hints[label] || []);
  }
}

export function collectMsrLists(wiring: SettingsWiring): { version: number; lists: Record<string, any> } {
  const lists: Record<string, any> = {};
  for (const [key, id] of MSR_LIST_FIELDS) lists[key] = wiring.chips[id].getValues();
  const rootCause: Record<string, string[]> = {};
  for (const [key, id] of MSR_RC_FIELDS) rootCause[key] = wiring.chips[id].getValues();
  lists.rootCause = rootCause;
  const hints: Record<string, string[]> = {};
  for (const label of kwLabels(lists)) {
    const chip = wiring.kwChips[label];
    if (chip) hints[label] = chip.getValues();
  }
  lists.hints = hints;
  return { version: 2, lists };
}

export { MSR_DEFAULT_LISTS };

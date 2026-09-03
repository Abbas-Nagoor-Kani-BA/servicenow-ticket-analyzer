/**
 * Calclens highlight-toggle owner.
 *
 * Single owner of which attention rules are allowed to paint their cell
 * highlight. Unlike the Calclens mode flag (session-only, see
 * calclens-state.ts) this preference IS persisted: the enabled set survives
 * reloads via chrome.storage.local.
 *
 * The persisted payload stores DISABLED ids only, so any rule added to
 * ATTENTION_RULES in the future defaults to enabled without a migration. All
 * rules start enabled; a missing or partial stored value fills the gaps as
 * enabled. Unknown ids in storage are ignored (validated against
 * ATTENTION_RULES).
 *
 * This module only owns presentation state; it never changes rule semantics
 * (which live in the pure core/attention.ts).
 */
import { ATTENTION_RULES } from "../../core/attention.ts";
import type { AttentionRuleId } from "../../core/attention.ts";
import { STORAGE } from "../../lib/keys.ts";
import { loadOnce, saveValue } from "../../lib/storage.ts";

const ALL_IDS: AttentionRuleId[] = ATTENTION_RULES.map((r) => r.id);
const KNOWN = new Set<AttentionRuleId>(ALL_IDS);

/** The set of ids that are currently DISABLED (empty = everything on). */
let disabled = new Set<AttentionRuleId>();

function isKnown(id: unknown): id is AttentionRuleId {
  return typeof id === "string" && KNOWN.has(id as AttentionRuleId);
}

/** Persist the current disabled set (disabled ids only). */
function persist(): void {
  void saveValue(STORAGE.calclensHighlights, [...disabled]);
}

/** Load the persisted disabled set. Mirrors grid.ts's loadAttentionCtx. */
export async function loadHighlightPrefs(): Promise<void> {
  const stored = await loadOnce<unknown[]>(STORAGE.calclensHighlights, []);
  const next = new Set<AttentionRuleId>();
  if (Array.isArray(stored)) {
    for (const id of stored) if (isKnown(id)) next.add(id);
  }
  disabled = next;
}

/** True when the rule's highlight is allowed to paint. */
export function isHighlightEnabled(id: AttentionRuleId): boolean {
  return !disabled.has(id);
}

/** Enable or disable one rule's highlight, then persist. */
export function setHighlightEnabled(id: AttentionRuleId, on: boolean): void {
  if (!isKnown(id)) return;
  if (on) disabled.delete(id);
  else disabled.add(id);
  persist();
}

/** Enable or disable every rule's highlight, then persist. */
export function setAll(on: boolean): void {
  disabled = on ? new Set() : new Set(ALL_IDS);
  persist();
}

/** The set of currently ENABLED rule ids. */
export function enabledSet(): Set<AttentionRuleId> {
  return new Set(ALL_IDS.filter((id) => !disabled.has(id)));
}

/** How many rules are enabled. */
export function enabledCount(): number {
  return ALL_IDS.length - disabled.size;
}

/** How many rules are disabled. */
export function disabledCount(): number {
  return disabled.size;
}

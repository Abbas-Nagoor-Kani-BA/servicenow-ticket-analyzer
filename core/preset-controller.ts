import { buildWsrFilterSets } from "./wsrpreset.ts";
import { WSR_PRESET_VALUE } from "../data/repositories/preset-repository.ts";
import type { UserPreset } from "../data/repositories/preset-repository.ts";
import type { FilterSet } from "../data/repositories/filter-list-repository.ts";

export type PresetOption = { value: string; label: string };

/** Dropdown options: the built-in WSR entry first, then user presets in order. */
export function presetOptions(userPresets: UserPreset[]): PresetOption[] {
  return [
    { value: WSR_PRESET_VALUE, label: "WSR" },
    ...userPresets.map((p) => ({ value: p.name, label: p.name }))
  ];
}

/**
 * Resolve a selected dropdown value to the filter sets it loads. The WSR entry
 * is synthesized fresh (last-week dates recompute); a user value returns its
 * stored sets; an unknown value returns [].
 */
export function resolvePresetSets(value: string, userPresets: UserPreset[], now: Date = new Date()): FilterSet[] {
  if (value === WSR_PRESET_VALUE) return buildWsrFilterSets(now);
  return userPresets.find((p) => p.name === value)?.sets ?? [];
}

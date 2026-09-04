import { STORAGE } from "../../lib/keys.ts";
import { KEY_VALUE_STORE } from "../../di/tokens.ts";
import type { KeyValueStore } from "../key-value-store.ts";
import type { FilterSet } from "./filter-list-repository.ts";

/** The reserved value/name for the built-in WSR preset; users cannot shadow it. */
export const WSR_PRESET_VALUE = "__wsr__";

/** A user-saved named filter preset: a name plus the saved filter sets. */
export type UserPreset = {
  name: string;
  sets: FilterSet[];
};

export type AddPresetOutcome = "added" | "duplicate" | "empty-name" | "reserved";

export interface PresetRepository {
  load(): Promise<UserPreset[]>;
  save(presets: UserPreset[]): Promise<void>;
  add(name: string, sets: FilterSet[]): Promise<AddPresetOutcome>;
  remove(name: string): Promise<void>;
}

function normName(s: string): string {
  return s.trim().toLowerCase();
}

export class PresetStore implements PresetRepository {
  static readonly deps = [KEY_VALUE_STORE] as const;

  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  async load(): Promise<UserPreset[]> {
    const raw = await this.store.get<unknown>(STORAGE.snFilterPresets, []);
    if (!Array.isArray(raw)) return [];
    return raw.filter((p): p is UserPreset =>
      !!p && typeof p === "object" &&
      typeof (p as { name?: unknown }).name === "string" &&
      Array.isArray((p as { sets?: unknown }).sets));
  }

  save(presets: UserPreset[]): Promise<void> {
    return this.store.set(STORAGE.snFilterPresets, presets);
  }

  async add(name: string, sets: FilterSet[]): Promise<AddPresetOutcome> {
    const trimmed = name.trim();
    if (!trimmed) return "empty-name";
    if (normName(trimmed) === WSR_PRESET_VALUE || normName(trimmed) === "wsr") return "reserved";
    const presets = await this.load();
    if (presets.some((p) => normName(p.name) === normName(trimmed))) return "duplicate";
    presets.push({ name: trimmed, sets });
    await this.save(presets);
    return "added";
  }

  async remove(name: string): Promise<void> {
    const presets = await this.load();
    await this.save(presets.filter((p) => normName(p.name) !== normName(name)));
  }
}

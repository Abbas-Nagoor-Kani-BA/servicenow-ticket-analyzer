import { STORAGE } from "../../lib/keys.ts";
import { KEY_VALUE_STORE } from "../../di/tokens.ts";
import type { KeyValueStore } from "../key-value-store.ts";

export type ViewerSelection = { a: string; f: string };

export type ViewerPrefs = {
  selection: ViewerSelection | null;
  hiddenCols: string[];
  colWidths: Record<string, number>;
  msrLists: Record<string, unknown> | null;
};

export interface ViewerPrefsRepository {
  /** Loads every viewer preference in one storage round-trip. */
  loadAll(): Promise<ViewerPrefs>;
  saveSelection(sel: ViewerSelection | null): Promise<void>;
  saveHiddenCols(cols: string[]): Promise<void>;
  saveColWidths(widths: Record<string, number>): Promise<void>;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function asWidths(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, width] of Object.entries(value as Record<string, unknown>)) {
    if (typeof width === "number" && Number.isFinite(width)) out[key] = width;
  }
  return out;
}

export class ViewerPrefsStore implements ViewerPrefsRepository {
  static readonly deps = [KEY_VALUE_STORE] as const;

  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  async loadAll(): Promise<ViewerPrefs> {
    const [selection, hiddenCols, colWidths, msrLists] = await Promise.all([
      this.store.get<unknown>(STORAGE.viewerSel, null),
      this.store.get<unknown>(STORAGE.viewerHiddenCols, []),
      this.store.get<unknown>(STORAGE.viewerColWidths, {}),
      this.store.get<unknown>(STORAGE.msrLists, null)
    ]);
    const sel = selection as Partial<ViewerSelection> | null;
    return {
      selection: sel && sel.a && sel.f ? { a: String(sel.a), f: String(sel.f) } : null,
      hiddenCols: asStringArray(hiddenCols),
      colWidths: asWidths(colWidths),
      msrLists: (msrLists as { lists?: Record<string, unknown> } | null)?.lists ?? null
    };
  }

  saveSelection(sel: ViewerSelection | null): Promise<void> {
    return sel ? this.store.set(STORAGE.viewerSel, sel) : this.store.remove(STORAGE.viewerSel);
  }

  saveHiddenCols(cols: string[]): Promise<void> {
    return this.store.set(STORAGE.viewerHiddenCols, cols);
  }

  saveColWidths(widths: Record<string, number>): Promise<void> {
    return this.store.set(STORAGE.viewerColWidths, widths);
  }
}

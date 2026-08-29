import { STORAGE } from "../../lib/keys.ts";
import { KEY_VALUE_STORE } from "../../di/tokens.ts";
import type { KeyValueStore } from "../key-value-store.ts";

export type StoredTemplate = {
  /** Base64-encoded .xlsx bytes of the user's formatted workbook. */
  base64: string;
  name: string;
  at: string;
};

export interface TemplateRepository {
  load(): Promise<StoredTemplate | null>;
  save(template: StoredTemplate): Promise<void>;
  clear(): Promise<void>;
}

export class TemplateStore implements TemplateRepository {
  static readonly deps = [KEY_VALUE_STORE] as const;

  private readonly store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.store = store;
  }

  load(): Promise<StoredTemplate | null> {
    return this.store.get<StoredTemplate | null>(STORAGE.snXlsxTemplate, null);
  }

  save(template: StoredTemplate): Promise<void> {
    return this.store.set(STORAGE.snXlsxTemplate, template);
  }

  clear(): Promise<void> {
    return this.store.remove(STORAGE.snXlsxTemplate);
  }
}

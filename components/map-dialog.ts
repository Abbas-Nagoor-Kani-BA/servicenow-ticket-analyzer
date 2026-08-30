import { Component, el } from "./component.ts";
import type { ComponentProps } from "./component.ts";
import { colLetter, letterToColNum } from "../lib/markup.js";
import { placePopupNear } from "../lib/markup.js";
import { setTip } from "../lib/tooltip.js";
import type { Modal } from "./modal.ts";

/** A field id, its display label, and any exporter-specific extras. */
export type MapField = readonly [string, string, ...unknown[]];

export type MapFieldGroup = {
  name: string;
  items: MapField[];
};

export type MapDialogState = {
  /** field id -> spreadsheet column letter */
  mapping: Record<string, string>;
  query: string;
  letterQuery: string;
  /** Field whose column is being picked, or null when the picker is closed. */
  targetFid: string | null;
};

export type MapDialogDeps = {
  search: HTMLInputElement;
  list: HTMLElement;
  letterPop: Modal;
  letterSearch: HTMLInputElement;
  letterList: HTMLElement;
  groups: MapFieldGroup[];
  /** Human label for a field id, used to mark columns already taken. */
  fieldLabel: (fid: string) => string;
  onSave: (mapping: Record<string, string>) => Promise<void>;
  onReset: () => Promise<void>;
  status: (message: string, isError?: boolean) => void;
};

export type MapDialogRefs = {
  search: HTMLInputElement;
  list: HTMLElement;
  letterSearch: HTMLInputElement;
  letterList: HTMLElement;
  rows: Map<string, { row: HTMLElement; pick: HTMLElement }>;
};

const NOT_EXPORTED = "— not exported —";

/**
 * Export column mapping: which spreadsheet column each field writes to.
 *
 * Two invariants the component enforces rather than the caller:
 *
 * - one column holds at most one field, so assigning a column evicts whoever
 *   held it
 * - the mapping cannot be saved while two fields point at the same column,
 *   which would silently overwrite cells in the exported workbook
 */
export class MapDialog extends Component<MapDialogState, ComponentProps, MapDialogDeps> {
  protected declare refs: MapDialogRefs;

  protected initialState(): MapDialogState {
    return { mapping: {}, query: "", letterQuery: "", targetFid: null };
  }

  protected build(): void {
    this.refs.search = this.deps.search;
    this.refs.list = this.deps.list;
    this.refs.letterSearch = this.deps.letterSearch;
    this.refs.letterList = this.deps.letterList;
    this.refs.rows = new Map();

    this.buildRows();

    this.refs.search.addEventListener("input", () => {
      this.setState({ query: this.refs.search.value });
    });
    this.refs.letterSearch.addEventListener("input", () => {
      this.setState({ letterQuery: this.refs.letterSearch.value });
    });
    this.refs.letterSearch.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      (this.refs.letterList.firstElementChild as HTMLElement | null)?.click();
    });
  }

  protected patch(next: MapDialogState, prev: MapDialogState | null): void {
    const mappingChanged = !prev || next.mapping !== prev.mapping;

    if (mappingChanged) this.syncRowButtons(next.mapping);
    if (!prev || next.query !== prev.query || mappingChanged) this.applyFilter(next.query);
    if (mappingChanged || !prev || next.letterQuery !== prev.letterQuery || next.targetFid !== prev.targetFid) {
      this.buildLetterOptions(next);
    }
  }

  /** Loads a stored mapping, dropping anything unknown or out of range. */
  show(stored: Record<string, string> | null, defaults: Record<string, string>): void {
    const base = stored && Object.keys(stored).length ? stored : defaults;
    const mapping: Record<string, string> = {};
    for (const [fid, letter] of Object.entries(base)) {
      const col = letterToColNum(letter);
      if (this.knowsField(fid) && col >= 1 && col <= MAX_COL) mapping[fid] = colLetter(col);
    }
    this.setState({ mapping, query: "", letterQuery: "", targetFid: null });
    this.refs.search.value = "";
    setTimeout(() => this.refs.search.focus(), 0);
  }

  protected knowsField(fid: string): boolean {
    return this.deps.groups.some((g) => g.items.some(([id]) => id === fid));
  }

  protected buildRows(): void {
    const list = this.refs.list;
    list.innerHTML = "";
    this.refs.rows.clear();

    for (const group of this.deps.groups) {
      for (const [fid, label] of group.items) {
        const row = el("div", "mapRow");
        row.dataset.fid = fid;
        row.dataset.label = label;

        const text = el("span", undefined, label);
        setTip(text, label);

        const pick = el("button", "mapPick");
        (pick as HTMLButtonElement).type = "button";
        setTip(pick, "Click to search and pick a column (A–AN)");
        pick.addEventListener("click", (e) => {
          e.stopPropagation();
          this.toggleLetterPop(fid, pick);
        });

        row.append(text, pick);
        list.appendChild(row);
        this.refs.rows.set(fid, { row, pick });
      }
    }

    const none = el("div", "mapNone");
    none.style.display = "none";
    list.appendChild(none);
  }

  protected syncRowButtons(mapping: Record<string, string>): void {
    for (const [fid, { pick }] of this.refs.rows) {
      const letter = mapping[fid] || "";
      pick.textContent = letter || NOT_EXPORTED;
      pick.classList.toggle("set", !!letter);
    }
  }

  protected applyFilter(query: string): void {
    const q = query.trim().toLowerCase();
    let visible = 0;

    for (const [, { row }] of this.refs.rows) {
      const hit = !q || (row.dataset.label || "").toLowerCase().includes(q);
      row.style.display = hit ? "" : "none";
      if (hit) visible++;
    }

    const none = this.refs.list.querySelector(".mapNone") as HTMLElement | null;
    if (!none) return;
    if (!visible && q) {
      none.textContent = `No fields match "${query.trim()}"`;
      none.style.display = "";
    } else {
      none.style.display = "none";
    }
  }

  protected toggleLetterPop(fid: string, anchor: HTMLElement): void {
    if (this.deps.letterPop.isOpen() && this.getState().targetFid === fid) {
      this.hideLetterPop();
      return;
    }
    this.setState({ targetFid: fid, letterQuery: "" });
    this.refs.letterSearch.value = "";
    this.deps.letterPop.open();

    const pop = this.refs.letterSearch.closest("#letterPop") as HTMLElement | null;
    if (pop) placePopupNear(pop, anchor.getBoundingClientRect(), 220);
    this.refs.letterSearch.focus();
  }

  protected hideLetterPop(): void {
    this.deps.letterPop.close();
    this.setState({ targetFid: null });
  }

  protected buildLetterOptions(state: MapDialogState): void {
    const list = this.refs.letterList;
    list.innerHTML = "";

    const q = state.letterQuery.trim().toLowerCase();
    const holders: Record<string, string> = {};
    for (const [fid, letter] of Object.entries(state.mapping)) {
      if (letter) holders[letter] = fid;
    }

    const add = (value: string, label: string, holder: string | null): void => {
      const option = el("div", "letterOpt");
      if (value === "" && holder === null) option.classList.add("none");
      if (!value) option.classList.add("none");

      if (holder) {
        option.classList.add("taken");
        const tag = el("span", "holder", `· ${holder}`);
        option.append(el("span", undefined, label), " ", tag);
      } else {
        option.textContent = label;
      }

      option.addEventListener("click", () => this.assignLetter(value));
      list.appendChild(option);
    };

    if (!q || NOT_EXPORTED.toLowerCase().includes(q)) add("", NOT_EXPORTED, null);

    for (let c = 1; c <= MAX_COL; c++) {
      const letter = colLetter(c);
      if (q && !letter.toLowerCase().startsWith(q)) continue;
      const holderFid = holders[letter];
      // A column held by the field being edited is not "taken" — it is current.
      const holder = holderFid && holderFid !== state.targetFid ? this.deps.fieldLabel(holderFid) : null;
      add(letter, letter, holder);
    }
  }

  protected assignLetter(value: string): void {
    const fid = this.getState().targetFid;
    if (!fid) return;

    const mapping = { ...this.getState().mapping };
    if (value) {
      for (const [other, letter] of Object.entries(mapping)) {
        if (other !== fid && letter === value) delete mapping[other];
      }
      mapping[fid] = value;
    } else {
      delete mapping[fid];
    }

    this.setState({ mapping });
    this.hideLetterPop();
  }

  /** Validates and persists. Rejects duplicate columns and an empty mapping. */
  async save(): Promise<void> {
    const entries = Object.entries(this.getState().mapping).filter(([, letter]) => letter);
    const seen = new Set<string>();

    for (const [, letter] of entries) {
      if (seen.has(letter)) {
        this.deps.status(`Two fields point at column ${letter} — fix before saving`, true);
        return;
      }
      seen.add(letter);
    }
    if (!entries.length) {
      this.deps.status("Map at least one field before saving", true);
      return;
    }

    await this.deps.onSave(Object.fromEntries(entries));
    this.deps.status(
      `Export mapping saved — ${entries.length} field(s), columns ${this.lettersSpan(entries)}`
    );
  }

  /** Drops the stored mapping and restores the defaults. */
  async reset(defaults: Record<string, string>): Promise<void> {
    await this.deps.onReset();
    this.show(null, defaults);
  }

  /** Column letters in use, ascending, for the confirmation message. */
  lettersSpan(entries: [string, string][]): string {
    return entries
      .map(([, letter]) => letterToColNum(letter))
      .sort((a, b) => a - b)
      .map(colLetter)
      .join(", ");
  }
}

/** Widest spreadsheet column the template supports (A–AN). */
export const MAX_COL = 40;

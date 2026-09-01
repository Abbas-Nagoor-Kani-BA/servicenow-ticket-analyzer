import { Component, el } from "./component.ts";
import type { ComponentProps } from "./component.ts";
import { placePopupNear } from "../lib/markup.ts";
import {
  applyPickFilter,
  paintPickItems,
  pickCurNotInOptions,
  pickLabelOf
} from "../lib/picklist.ts";

/** How the user committed, so callers can advance the selection differently. */
export type PickIntent = "enter" | "tab" | "tab-back" | "pointer";

export type SearchPickerState = {
  query: string;
  firstOpen: boolean;
  items: string[];
  activeIdx: number;
};

export type SearchPickerDeps = {
  /** Element the popup is positioned against. */
  anchor: HTMLElement;
  options: string[];
  current: string;
  minWidth?: number;
  /** Extra panel beside the list, e.g. the ticket activity pane. */
  aside?: HTMLElement | null;
  /** Scrolling this element repositions the popup. */
  repositionOn?: HTMLElement | null;
  onPick: (value: string, intent: PickIntent) => void;
  onDismiss: () => void;
};

export type SearchPickerRefs = {
  pop: HTMLElement;
  input: HTMLInputElement;
  list: HTMLElement;
  foot: HTMLElement;
};

/**
 * Searchable option picker for the Calclens drawer's derivation-column pickers.
 *
 * These were two near-identical ~130 line implementations (DEDUP-005) that had
 * already drifted: only one dismissed on an outside click, and they advanced
 * the selection differently. There is now one definition, with the behavioural
 * difference expressed as the `intent` handed to `onPick`.
 *
 * Appended to `document.body` and positioned against `deps.anchor`. Callers
 * hold the instance instead of a module-level `activeFinish` / `nestedPickState`
 * singleton, so two pickers can no longer fight over one slot.
 */
export class SearchPicker extends Component<SearchPickerState, ComponentProps, SearchPickerDeps> {
  protected declare refs: SearchPickerRefs;

  #closed = false;
  #onDocDown: (e: MouseEvent) => void;
  #onScroll: () => void;

  constructor(root: HTMLElement, props: ComponentProps, deps: SearchPickerDeps) {
    super(root, props, deps);
    // Assigned after super() because private fields are installed only once it
    // returns; build() must not touch them.
    this.#onDocDown = (e) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (!this.refs.pop.contains(target) && target !== this.deps.anchor) this.dismiss();
    };
    this.#onScroll = () => this.place();

    document.addEventListener("mousedown", this.#onDocDown, true);
    this.deps.repositionOn?.addEventListener("scroll", this.#onScroll);

    this.refs.input.focus();
    this.place();
  }

  protected initialState(): SearchPickerState {
    return { query: "", firstOpen: true, items: [], activeIdx: 0 };
  }

  protected build(): void {
    this.refs.pop = el("div", "msrPick" + (this.deps.aside ? " wide" : ""));

    this.refs.input = el("input", "msrPickSearch");
    this.refs.input.placeholder = "Search or type initials\u2026";
    this.refs.input.autocomplete = "off";
    this.refs.input.spellcheck = false;

    this.refs.list = el("div", "msrPickList");
    this.refs.foot = el("div", "msrPickFoot");

    if (this.deps.aside) {
      const main = el("div", "msrPickMain");
      main.append(this.refs.input, this.refs.list, this.refs.foot);
      this.refs.pop.append(main, this.deps.aside);
    } else {
      this.refs.pop.append(this.refs.input, this.refs.list, this.refs.foot);
    }

    this.root.appendChild(this.refs.pop);

    this.refs.input.addEventListener("keydown", (e) => this.onKey(e));
    this.refs.input.addEventListener("input", () => this.onInput());
    this.refs.input.addEventListener("blur", () => this.onBlur());

    // Seed the list. Without this the popup opens empty and only fills in
    // after the first keystroke, which the original avoided by calling
    // renderList() (applyFilter + paint) explicitly.
    this.applyFilter();
  }

  protected patch(next: SearchPickerState, prev: SearchPickerState | null): void {
    if (!prev || next.items !== prev.items || next.activeIdx !== prev.activeIdx) this.paint();
  }

  protected paint(): void {
    const state = this.getState();
    const cur = String(this.deps.current ?? "");
    const notIn = pickCurNotInOptions(this.deps.options, cur);
    paintPickItems(this.refs.list, this.refs.foot, state.items, state.activeIdx, (value: string) =>
      this.renderItem(value, cur, notIn)
    );
  }

  protected renderItem(value: string, cur: string, notIn: boolean): HTMLElement {
    const node = el("div");
    node.textContent = pickLabelOf(value, cur, notIn);
    node.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.commit(value, "pointer");
    });
    return node;
  }

  /** Options plus a leading "clear" entry and the current value when off-list. */
  protected entries(): string[] {
    const { options, current } = this.deps;
    const cur = String(current ?? "");
    const entries = ["", ...options];
    if (cur && !options.some((x) => String(x).toLowerCase() === cur.toLowerCase())) entries.push(cur);
    return entries;
  }

  protected applyFilter(): void {
    const state = this.getState();
    const cur = String(this.deps.current ?? "");
    const q = state.firstOpen ? "" : state.query.trim().toLowerCase();
    const refVal = state.firstOpen ? cur : state.query;
    const res = applyPickFilter(this.entries(), q, refVal, cur);
    this.setState({ items: res.items, activeIdx: res.activeIdx });
  }

  protected onInput(): void {
    this.setState({ firstOpen: false, query: this.refs.input.value });
    this.applyFilter();
  }

  protected onBlur(): void {
    // Deferred so a pointerdown on an item wins over the blur.
    setTimeout(() => {
      if (!this.#closed && this.refs.pop.isConnected) this.dismiss();
    }, 0);
  }

  protected onKey(e: KeyboardEvent): void {
    const state = this.getState();

    if (e.key === "ArrowDown" && state.items.length) {
      e.preventDefault();
      this.setState({ activeIdx: (state.activeIdx + 1) % state.items.length });
      return;
    }
    if (e.key === "ArrowUp" && state.items.length) {
      e.preventDefault();
      this.setState({ activeIdx: (state.activeIdx - 1 + state.items.length) % state.items.length });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (!this.commitActive("enter")) this.flashInvalid();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (!this.commitActive(e.shiftKey ? "tab-back" : "tab")) this.flashInvalid();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.dismiss();
    }
  }

  /** Commits an exact query match when there is one, else the active item. */
  protected commitActive(intent: PickIntent): boolean {
    const state = this.getState();
    if (!state.items.length) return false;
    const q = state.query.trim().toLowerCase();
    const exact = state.firstOpen ? undefined : state.items.find((v) => String(v).toLowerCase() === q);
    const value = exact !== undefined ? exact : state.items[state.activeIdx];
    this.commit(value, intent);
    return true;
  }

  protected commit(value: string, intent: PickIntent): void {
    if (this.#closed) return;
    this.deps.onPick(value, intent);
    this.close();
  }

  /**
   * Commits the active item from outside, as if the user had pressed Enter.
   *
   * The grid needs this to close the open editor before opening the next cell.
   * Returns false when there is nothing to commit, which is the "invalid, stay
   * open" signal the callers use to veto a move.
   */
  commitNow(intent: PickIntent = "enter"): boolean {
    if (this.#closed) return true;
    return this.commitActive(intent);
  }

  /** Closes without committing. */
  cancelNow(): void {
    if (this.#closed) return;
    this.dismiss();
  }

  protected dismiss(): void {
    if (this.#closed) return;
    this.deps.onDismiss();
    this.close();
  }

  protected flashInvalid(): void {
    this.refs.input.classList.add("invalid");
    setTimeout(() => this.refs.input.classList.remove("invalid"), 450);
  }

  protected place(): void {
    if (this.#closed || !this.refs.pop.isConnected) return;
    placePopupNear(this.refs.pop, this.deps.anchor.getBoundingClientRect(), this.deps.minWidth ?? 300);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    document.removeEventListener("mousedown", this.#onDocDown, true);
    this.deps.repositionOn?.removeEventListener("scroll", this.#onScroll);
    this.refs.pop.remove();
    this.destroy();
  }
}

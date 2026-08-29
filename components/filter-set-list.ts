import { Component, el } from "./component.ts";
import type { ComponentProps } from "./component.ts";
import type { FilterListRepository, FilterSet } from "../data/repositories/filter-list-repository.ts";
import { setTip } from "../lib/tooltip.js";

export type FilterSetListState = {
  sets: FilterSet[];
};

export type FilterSetListDeps = {
  /** Persisted filter sets. The component never touches storage directly. */
  repository: FilterListRepository;
  /** The card is hidden while the list is empty. */
  card: HTMLElement;
  /** Button whose label doubles as the count. */
  addButton: HTMLElement;
  describe: (set: FilterSet) => string;
  keyOf: (set: FilterSet) => string;
};

/**
 * The panel's saved filter sets.
 *
 * Unlike the condition builder this rebuilds its list on every change: the
 * items contain no text inputs, so there is no focus or caret to preserve, and
 * a handful of rows costs nothing. Simplicity beats a diff here.
 */
export class FilterSetList extends Component<FilterSetListState, ComponentProps, FilterSetListDeps> {
  protected declare refs: { list: HTMLElement };

  protected initialState(): FilterSetListState {
    return { sets: [] };
  }

  protected build(): void {
    this.refs.list = this.root;
  }

  protected patch(next: FilterSetListState, prev: FilterSetListState | null): void {
    if (!prev || next.sets !== prev.sets) this.rebuild(next);
  }

  /** Loads persisted sets. Call once during startup. */
  async load(): Promise<void> {
    this.setState({ sets: await this.deps.repository.load() });
  }

  getSets(): FilterSet[] {
    return this.getState().sets.slice();
  }

  /** @returns "duplicate" when an identical set is already stored */
  async add(set: FilterSet): Promise<"added" | "duplicate"> {
    const key = this.deps.keyOf(set);
    if (this.getState().sets.some((s) => this.deps.keyOf(s) === key)) return "duplicate";
    await this.replace([...this.getState().sets, set]);
    return "added";
  }

  async removeAt(index: number): Promise<void> {
    await this.replace(this.getState().sets.filter((_, i) => i !== index));
  }

  async clear(): Promise<void> {
    await this.replace([]);
  }

  /** Draws attention to the card. Used after adding a set. */
  flash(): void {
    const card = this.deps.card;
    card.classList.remove("flash");
    void card.offsetWidth;
    card.classList.add("flash");
    setTimeout(() => card.classList.remove("flash"), 1000);
  }

  protected async replace(sets: FilterSet[]): Promise<void> {
    this.setState({ sets });
    await this.deps.repository.save(sets);
    this.emit("change");
  }

  protected rebuild(state: FilterSetListState): void {
    const { sets } = state;
    const { card, addButton } = this.deps;

    card.classList.toggle("hidden", sets.length === 0);
    addButton.textContent = sets.length
      ? `Add to filter list (${sets.length})`
      : "+ Add to filter list";

    this.refs.list.innerHTML = "";
    sets.forEach((set, index) => {
      this.refs.list.appendChild(this.renderItem(set, index));
    });
  }

  protected renderItem(set: FilterSet, index: number): HTMLElement {
    const row = el("div", "flitem");
    const label = el("span");
    label.textContent = this.deps.describe(set);

    const remove = el("button", undefined, "\u2715");
    remove.type = "button";
    setTip(remove, "Remove");
    remove.addEventListener("click", () => {
      void this.removeAt(index);
    });

    row.append(label, remove);
    return row;
  }
}

/**
 * One-time import of filter sets saved by the pre-refactor panel, which used
 * `localStorage` rather than `chrome.storage.local`.
 *
 * Without this, a user's saved sets would simply vanish on first load after
 * upgrading.
 */
export async function migrateLegacyFilterSets(repository: FilterListRepository): Promise<number> {
  let legacy: unknown;
  try {
    legacy = JSON.parse(globalThis.localStorage?.getItem("snFilterList") || "[]");
  } catch {
    return 0;
  }
  if (!Array.isArray(legacy) || !legacy.length) return 0;

  const existing = await repository.load();
  if (existing.length) {
    try {
      globalThis.localStorage?.removeItem("snFilterList");
    } catch {
      /* storage disabled — nothing to clean up */
    }
    return 0;
  }

  const sets = legacy.filter((s): s is FilterSet => !!s && typeof s === "object");
  await repository.save(sets);
  try {
    globalThis.localStorage?.removeItem("snFilterList");
  } catch {
    /* ignore */
  }
  return sets.length;
}

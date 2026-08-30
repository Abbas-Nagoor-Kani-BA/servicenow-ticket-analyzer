import { Component, el } from "./component.ts";
import type { ComponentProps } from "./component.ts";
import { setTip } from "../lib/tooltip.ts";

export type CiGroup = {
  name: string;
  items: string[];
};

export type CiSplitValue = {
  enabled: boolean;
  groups: CiGroup[];
};

export type CiDialogState = {
  enabled: boolean;
  groups: CiGroup[];
};

export type CiDialogDeps = {
  /** Persist the committed value. Throw to surface a save error. */
  onSave: (value: CiSplitValue) => Promise<void> | void;
  /** Persist the "disabled" state, which also drops any stored groups. */
  onDisable: () => Promise<void> | void;
  /** Runs after the dialog closes by any route, e.g. to re-sync the radios. */
  onClosed: () => void;
  status: (message: string, isError?: boolean) => void;
};

export type CiDialogRefs = {
  enabled: HTMLInputElement;
  board: HTMLElement;
  save: HTMLElement;
  disable: HTMLElement;
  cancel: HTMLElement;
  close: HTMLElement;
  addGroup: HTMLElement;
};

/**
 * The "separate files per configuration item" editor.
 *
 * Edits a draft copy and only commits on Save, so cancelling leaves the stored
 * split untouched. Group names are de-duplicated on save by suffixing a counter,
 * which is what keeps two groups from exporting to the same filename.
 */
export class CiDialog extends Component<CiDialogState, ComponentProps, CiDialogDeps> {
  protected declare refs: CiDialogRefs;

  /** Transient drag source; module-level because it changes per dragstart. */
  #dragSrc: { gi: number; ii: number } | null = null;

  protected initialState(): CiDialogState {
    return { enabled: false, groups: [] };
  }

  protected build(): void {
    this.refs.enabled = this.q<HTMLInputElement>("#ciEnabled");
    this.refs.board = this.q("#groupBoard");
    this.refs.save = this.q("#ciSave");
    this.refs.disable = this.q("#ciDisable");
    this.refs.cancel = this.q("#ciCancel");
    this.refs.close = this.q("#ciClose");
    this.refs.addGroup = this.q("#addGroupBtn");

    this.refs.addGroup.addEventListener("click", () => {
      this.setState({ groups: [...this.getState().groups, { name: this.nextGroupName(), items: [] }] });
    });

    this.refs.save.addEventListener("click", () => {
      void this.commit();
    });
    this.refs.disable.addEventListener("click", () => {
      void this.disable();
    });
  }

  protected patch(next: CiDialogState, prev: CiDialogState | null): void {
    if (!prev || next.enabled !== prev.enabled) this.refs.enabled.checked = next.enabled;
    if (!prev || next.groups !== prev.groups) this.renderGroups(next.groups);
  }

  /** Opens on a fresh draft copied from the stored value. */
  show(value: CiSplitValue): void {
    this.setState({
      enabled: value.enabled,
      groups: value.groups.map((g) => ({ name: g.name, items: [...g.items] }))
    });
  }

  protected async commit(): Promise<void> {
    const enabled = this.refs.enabled.checked;
    const groups = this.normalisedGroups();

    if (enabled && !groups.length) {
      this.deps.status("Add at least one group or turn the split off", true);
      return;
    }
    if (enabled && !groups.some((g) => g.items.length)) {
      this.deps.status("Add at least one configuration item or turn the split off", true);
      return;
    }

    try {
      await this.deps.onSave({ enabled, groups });
    } catch (err) {
      this.deps.status(`Save failed: ${(err as Error).message}`, true);
      return;
    }

    this.deps.status(
      enabled
        ? `Split enabled — one file per group (${groups.length} groups)`
        : "Split disabled — exports stay a single file"
    );
    this.deps.onClosed();
  }

  protected async disable(): Promise<void> {
    await this.deps.onDisable();
    this.setState({ enabled: false, groups: [] });
    this.deps.status("Split disabled — exports stay a single file");
    this.deps.onClosed();
  }

  /** Trims names, drops empty groups, and de-duplicates names case-insensitively. */
  protected normalisedGroups(): CiGroup[] {
    const seen = new Set<string>();
    return this.getState()
      .groups.map((g) => ({ name: String(g.name ?? "").trim(), items: [...g.items] }))
      .filter((g) => g.items.length || g.name)
      .map((g, i) => {
        if (!g.name) g.name = `Group ${i + 1}`;
        let name = g.name;
        let k = 2;
        while (seen.has(name.toLowerCase())) name = `${g.name} ${k++}`;
        seen.add(name.toLowerCase());
        return { name, items: g.items };
      });
  }

  protected nextGroupName(): string {
    const used = new Set(this.getState().groups.map((g) => g.name.toLowerCase()));
    for (let i = 0; i < 26; i++) {
      const name = `Group ${String.fromCharCode(65 + i)}`;
      if (!used.has(name.toLowerCase())) return name;
    }
    return `Group ${this.getState().groups.length + 1}`;
  }

  protected renderGroups(groups: CiGroup[]): void {
    const board = this.refs.board;
    board.innerHTML = "";
    groups.forEach((group, gi) => board.appendChild(this.renderGroup(group, gi)));
  }

  protected renderGroup(group: CiGroup, gi: number): HTMLElement {
    const card = el("div", "ciGroupCard");

    const head = el("div", "ciGroupHead");
    const nameIn = el("input", "ciGroupName") as HTMLInputElement;
    nameIn.value = group.name;
    nameIn.placeholder = `Group ${gi + 1}`;
    nameIn.addEventListener("change", () => {
      const trimmed = nameIn.value.trim();
      if (!trimmed) {
        nameIn.value = group.name;
        return;
      }
      group.name = trimmed;
    });

    const del = el("button", "ciDelGroup", "\u2715");
    del.type = "button";
    setTip(del, "Delete this group");
    del.addEventListener("click", () => {
      this.setState({ groups: this.getState().groups.filter((_, i) => i !== gi) });
    });
    head.append(nameIn, del);

    const list = el("div", "ciItems");
    list.dataset.gi = String(gi);
    list.addEventListener("dragover", (e) => {
      e.preventDefault();
      list.classList.add("dragOver");
    });
    list.addEventListener("dragleave", () => list.classList.remove("dragOver"));
    list.addEventListener("drop", (e) => {
      e.preventDefault();
      list.classList.remove("dragOver");
      this.dropItem(gi);
    });

    group.items.forEach((item, ii) => {
      const chip = el("div", "ciChip");
      (chip as HTMLElement & { draggable: boolean }).draggable = true;
      setTip(chip, "Drag to another group");
      const label = el("span", "lbl", item);
      const remove = el("button", "rm", "\u2715");
      remove.type = "button";
      setTip(remove, "Remove this configuration item");
      remove.addEventListener("click", () => {
        group.items.splice(ii, 1);
        this.setState({ groups: [...this.getState().groups] });
      });
      chip.addEventListener("dragstart", () => {
        this.#dragSrc = { gi, ii };
      });
      chip.append(label, remove);
      list.appendChild(chip);
    });

    const addRow = el("div", "ciAddRow");
    const input = el("input") as HTMLInputElement;
    input.placeholder = "Add configuration item";
    const addBtn = el("button", undefined, "+");
    addBtn.type = "button";
    setTip(addBtn, "Add to this group");
    addBtn.addEventListener("click", () => this.commitInput(input, gi));
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key !== "Enter") return;
      e.preventDefault();
      this.commitInput(input, gi);
    });
    input.addEventListener("paste", (e) => {
      const text = (e as ClipboardEvent).clipboardData?.getData("text") || "";
      if (!text || !/[\n,;]/.test(text)) return;
      e.preventDefault();
      this.addMany(gi, text);
    });
    addRow.append(input, addBtn);

    card.append(head, list, addRow);
    return card;
  }

  /** Adds one item unless it is blank or already present, case-insensitively. */
  protected addUnique(gi: number, raw: string): boolean {
    const text = String(raw ?? "").trim();
    if (!text) return false;
    const group = this.getState().groups[gi];
    if (!group) return false;
    if (group.items.some((x) => x.toLowerCase() === text.toLowerCase())) return false;
    group.items.push(text);
    return true;
  }

  protected commitInput(input: HTMLInputElement, gi: number): void {
    const added = this.addMany(gi, input.value);
    input.value = "";
    if (added) this.refreshAndFocus(gi);
  }

  protected addMany(gi: number, raw: string): number {
    let added = 0;
    for (const part of raw.split(/[\n,;]+/)) {
      if (this.addUnique(gi, part)) added++;
    }
    return added;
  }

  protected refreshAndFocus(gi: number): void {
    this.setState({ groups: [...this.getState().groups] });
    const input = this.refs.board
      .querySelectorAll(".ciGroupCard")
      [gi]?.querySelector(".ciAddRow input") as HTMLInputElement | undefined;
    input?.focus();
  }

  protected dropItem(targetGi: number): void {
    const src = this.#dragSrc;
    if (!src || targetGi === src.gi) return;

    const groups = this.getState().groups;
    const from = groups[src.gi];
    const to = groups[targetGi];
    if (!from || !to) return;

    const [item] = from.items.splice(src.ii, 1);
    if (item && !to.items.some((x) => x.toLowerCase() === item.toLowerCase())) {
      to.items.push(item);
    } else if (item) {
      from.items.splice(src.ii, 0, item);
    }

    this.#dragSrc = null;
    this.setState({ groups: [...groups] });
  }
}

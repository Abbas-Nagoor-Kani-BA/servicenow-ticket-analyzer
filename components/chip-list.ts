import { Component, el } from "./component.ts";
import type { ComponentProps } from "./component.ts";
import { normalizeNames, splitTerms } from "../core/names.ts";
import { setTip } from "../lib/tooltip.ts";

export type ChipListState = {
  values: string[];
  editing: boolean;
};

export type ChipListDeps = {
  /** Renders as a collapsed card with an Edit button instead of inline chips. */
  collapsible?: boolean;
  placeholder?: string;
};

export type ChipListRefs = {
  list?: HTMLElement;
  input?: HTMLInputElement;
  count?: HTMLElement;
  editBtn?: HTMLButtonElement;
  stack?: HTMLElement;
  emptyHint?: HTMLElement;
  textarea?: HTMLTextAreaElement;
  editor?: HTMLElement;
  saveBtn?: HTMLButtonElement;
  cancelBtn?: HTMLButtonElement;
};

/**
 * A list of text values edited as chips.
 *
 * In collapsible mode the normal state is a read-only card (value count plus
 * stacked rows) and editing swaps the body for a textarea — one value per line.
 * In inline mode chips are edited in place, committing on Enter or blur.
 *
 * Values are normalised through `splitTerms` on the way in, so pasting or
 * typing "a, b\nc" produces the same list either way.
 */
export class ChipList extends Component<ChipListState, ComponentProps, ChipListDeps> {
  protected declare refs: ChipListRefs;

  protected initialState(): ChipListState {
    return { values: [], editing: false };
  }

  protected build(): void {
    this.root.classList.add("flex", "flex-col", "gap-1.5");

    if (this.deps.collapsible) this.buildCollapsible();
    else this.buildInline();

    this.bindKeyboard();
  }

  protected buildCollapsible(): void {
    const refs = this.refs;

    refs.count = el("span", "chipCount text-dim text-[11px]");
    refs.editBtn = el("button", "chipEditBtn bg-transparent text-accent text-xs font-semibold px-1.5 underline underline-offset-[3px] cursor-pointer hover:brightness-125", "Edit");
    refs.editBtn.type = "button";
    setTip(refs.editBtn, "Edit these values");

    const head = el("div", "flex items-center justify-between gap-2 mb-1.5");
    head.append(refs.count, refs.editBtn);

    refs.stack = el("div", "chipStack flex flex-col gap-1 min-h-0 max-h-[170px] overflow-y-auto pr-1");
    refs.emptyHint = el("div", "chipEmpty text-dim text-xs italic py-0.5", "None — Edit to add");

    refs.textarea = el("textarea", "chipTextarea w-full min-h-[150px] resize-y font-mono");
    refs.textarea.placeholder = this.deps.placeholder || "One value per line — commas/semicolons also split";

    refs.saveBtn = el("button", "primary btn-primary py-1.5 px-3 text-xs", "Save");
    refs.saveBtn.type = "button";
    refs.cancelBtn = el("button", "btn py-1.5 px-3 text-xs", "Cancel");
    refs.cancelBtn.type = "button";

    const actions = el("div", "chipActions flex gap-2 justify-end mt-2");
    actions.append(refs.saveBtn, refs.cancelBtn);

    refs.editor = el("div", "chipEditor flex flex-col gap-1.5");
    refs.editor.append(refs.textarea, actions);

    const card = el("div", "chipCard min-h-0 bg-card2 border border-line rounded-lg p-2.5");
    card.append(head, refs.stack, refs.emptyHint, refs.editor);
    this.root.appendChild(card);

    refs.editBtn.addEventListener("click", () => {
      this.setState({ editing: true });
      refs.textarea?.focus();
      refs.textarea?.select();
    });
    refs.saveBtn.addEventListener("click", () => {
      this.setState({ values: splitTerms(refs.textarea?.value || ""), editing: false });
      this.emit("change");
    });
    refs.cancelBtn.addEventListener("click", () => this.setState({ editing: false }));
  }

  protected buildInline(): void {
    const refs = this.refs;
    refs.list = el("div", "chipList flex flex-wrap gap-[5px]");
    refs.input = el("input", "chipInput flex-1 min-w-[180px] border border-line bg-card2 text-text rounded px-2.5 py-1.5 text-[13px] font-sans focus:outline-none focus:border-accent");
    refs.input.placeholder = this.deps.placeholder || "Type a value and press Enter";
    this.root.append(refs.list, refs.input);
  }

  protected bindKeyboard(): void {
    const { textarea, input } = this.refs;

    textarea?.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") {
        e.preventDefault();
        this.setState({ editing: false });
      }
    });

    input?.addEventListener("keydown", (e) => {
      const key = (e as KeyboardEvent).key;
      if (key === "Enter") {
        e.preventDefault();
        this.commitInput();
      } else if (key === "Backspace" && !input.value && this.getState().values.length) {
        this.setState({ values: this.getState().values.slice(0, -1) });
        this.emit("change");
      }
    });
    input?.addEventListener("blur", () => this.commitInput());
    input?.addEventListener("paste", (e) => {
      const text = e.clipboardData ? e.clipboardData.getData("text") : "";
      if (!text || !/[\n,;]/.test(text)) return;
      e.preventDefault();
      this.append(splitTerms(text));
    });
  }

  protected patch(next: ChipListState, prev: ChipListState | null): void {
    if (!prev || next.values !== prev.values || next.editing !== prev.editing) {
      if (this.deps.collapsible) this.patchCollapsible(next);
      else this.patchInline(next);
    }
  }

  protected patchCollapsible(state: ChipListState): void {
    const { count, editBtn, stack, emptyHint, editor, textarea } = this.refs;
    if (!count || !editBtn || !stack || !emptyHint || !editor || !textarea) return;

    count.textContent = `${state.values.length} value${state.values.length === 1 ? "" : "s"}`;

    stack.innerHTML = "";
    for (const value of state.values) {
      stack.appendChild(el("div", "chipRow bg-bg border border-line rounded px-2.5 py-[5px] text-[12.5px] text-text whitespace-normal break-words hover:border-dim", value));
    }

    stack.hidden = state.editing;
    emptyHint.hidden = state.editing || state.values.length > 0;
    editor.hidden = !state.editing;
    editBtn.hidden = state.editing;
    if (state.editing) textarea.value = state.values.join("\n");
  }

  protected patchInline(state: ChipListState): void {
    const { list } = this.refs;
    if (!list) return;

    list.innerHTML = "";
    for (const value of state.values) {
      list.appendChild(this.renderChip(value));
    }
  }

  protected renderChip(value: string): HTMLElement {
    const chip = el("div", "chip flex items-center gap-1.5 bg-line border border-line rounded px-[7px] py-0.5 text-xs text-text max-w-full");
    const label = el("span", "truncate", value);

    const remove = el("button", "rm bg-transparent text-dim text-[11px] px-1 cursor-pointer hover:text-text", "\u2715");
    remove.type = "button";
    setTip(remove, "Remove");
    remove.addEventListener("click", () => {
      const lower = value.toLowerCase();
      this.setState({ values: this.getState().values.filter((v) => v.toLowerCase() !== lower) });
      this.emit("change");
    });

    chip.append(label, remove);
    return chip;
  }

  protected commitInput(): void {
    const input = this.refs.input;
    if (!input) return;
    const terms = splitTerms(input.value);
    if (!terms.length) return;
    input.value = "";
    this.append(terms);
  }

  protected append(terms: string[]): void {
    if (!terms.length) return;
    this.setState({ values: [...this.getState().values, ...terms] });
    this.emit("change");
  }

  getValues(): string[] {
    return this.getState().values.slice();
  }

  /** Normalises on the way in: legacy `{name, sysId}` objects collapse to their
   * name and duplicates are dropped case-insensitively. */
  setValues(values: string[]): void {
    this.setState({ values: normalizeNames(values || []), editing: false });
  }
}

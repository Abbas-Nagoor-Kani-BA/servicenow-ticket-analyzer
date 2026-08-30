import { Component, el } from "./component.ts";
import type { ComponentProps } from "./component.ts";
import { setTip } from "../lib/tooltip.ts";

export type CondFieldType = "ref" | "string" | "choice" | "date";

export type CondFieldDef = {
  key: string;
  label: string;
  field: string;
  type: CondFieldType;
  choicesKey?: string;
  tables?: string[];
};

export type Choice = { value: string | number; label: string };

export type ConditionRow = {
  join: "AND" | "OR";
  field: string;
  op: string;
  value: string;
  value2: string;
};

export type ConditionBuilderState = {
  table: string;
  rows: ConditionRow[];
};

export type ConditionBuilderDeps = {
  fields: CondFieldDef[];
  choiceList: (key: string) => Choice[];
  tableLabel: (table: string) => string;
  /** The "add condition" button, which lives outside the rows container. */
  addButton: HTMLElement;
};

export const COND_OPS: Record<CondFieldType, [string, string][]> = {
  ref: [
    ["isEmpty", "is empty"],
    ["isNotEmpty", "is not empty"]
  ],
  string: [
    ["contains", "contains"],
    ["notContains", "doesn't contain"],
    ["startsWith", "starts with"],
    ["eq", "is"],
    ["isEmpty", "is empty"],
    ["isNotEmpty", "is not empty"]
  ],
  choice: [
    ["eq", "is"],
    ["neq", "is not"]
  ],
  date: [
    ["before", "before"],
    ["after", "after"],
    ["between", "between"]
  ]
};

const NO_VALUE_OPS = ["isEmpty", "isNotEmpty"];

/**
 * Validates condition rows and converts them to the encoded-query shape.
 *
 * Pure and exported so it can be tested without a DOM; the messages are
 * user-facing, which is why it lives here rather than in the query builder.
 *
 * @throws with a message naming the offending row
 */
export function validateConditions(
  rows: ConditionRow[],
  deps: Pick<ConditionBuilderDeps, "fields" | "tableLabel">,
  table: string
): { join: string; field: string; oper: string; value: string; value2: string }[] {
  const allowed = deps.fields.filter((f) => !f.tables || f.tables.includes(table));

  return rows.map((row, i) => {
    const def = deps.fields.find((f) => f.key === row.field);
    if (!def) throw new Error(`Condition ${i + 1}: unknown column`);
    if (!allowed.includes(def)) {
      throw new Error(`Condition ${i + 1}: ${def.label} does not exist on ${deps.tableLabel(table)}`);
    }
    const known = (COND_OPS[def.type] || []).some(([v]) => v === row.op);
    if (!known) throw new Error(`Condition ${i + 1}: pick an operator`);
    if (!NO_VALUE_OPS.includes(row.op)) {
      if (!String(row.value || "").trim()) throw new Error(`Condition ${i + 1}: enter a value`);
      if (row.op === "between" && !String(row.value2 || "").trim()) {
        throw new Error(`Condition ${i + 1}: enter the second date`);
      }
    }
    return {
      join: i === 0 ? "AND" : row.join || "AND",
      field: def.field,
      oper: row.op,
      value: row.value || "",
      value2: row.value2 || ""
    };
  });
}

/**
 * The panel's condition rows.
 *
 * State is the array of rows; the DOM is a projection of it. The previous
 * implementation read the rows back out of the inputs in `collectConditions()`,
 * which meant the widget and the data could drift apart.
 *
 * Rows are rebuilt only when their *shape* changes. Typing in a value input
 * mutates state without touching the DOM, because rebuilding mid-keystroke
 * would drop focus and the caret.
 */
export class ConditionBuilder extends Component<ConditionBuilderState, ComponentProps, ConditionBuilderDeps> {
  protected declare refs: { list: HTMLElement; addBtn: HTMLElement };

  protected initialState(): ConditionBuilderState {
    return { table: "incident", rows: [] };
  }

  protected build(): void {
    this.refs.list = this.root;
    this.refs.addBtn = this.deps.addButton;
    this.refs.addBtn.addEventListener("click", () => this.addRow());
  }

  protected patch(next: ConditionBuilderState, prev: ConditionBuilderState | null): void {
    if (!prev || shapeOf(next) !== shapeOf(prev)) this.rebuild(next);
  }

  setTable(table: string): void {
    if (this.getState().table === table) return;
    const rows = this.getState().rows.map((row) => this.coerceRow(row, table));
    this.setState({ table, rows });
  }

  setRows(rows: ConditionRow[]): void {
    this.setState({ rows: rows.map((r) => this.coerceRow(r, this.getState().table)) });
  }

  addRow(): void {
    const table = this.getState().table;
    const first = this.allowedFields(table)[0];
    const rows = [
      ...this.getState().rows,
      {
        join: "AND" as const,
        field: first?.key || "",
        op: (COND_OPS[first?.type || "ref"][0] || [])[0] || "",
        value: "",
        value2: ""
      }
    ];
    this.setState({ rows });
    this.emit("change");
  }

  /** @throws with a user-facing message naming the offending row */
  conditions(): ReturnType<typeof validateConditions> {
    const { rows, table } = this.getState();
    return validateConditions(rows, this.deps, table);
  }

  protected allowedFields(table: string): CondFieldDef[] {
    return this.deps.fields.filter((f) => !f.tables || f.tables.includes(table));
  }

  protected coerceRow(row: ConditionRow, table: string): ConditionRow {
    const allowed = this.allowedFields(table);
    if (!allowed.some((f) => f.key === row.field)) {
      const first = allowed[0];
      return {
        join: row.join,
        field: first?.key || "",
        op: (COND_OPS[first?.type || "ref"][0] || [])[0] || "",
        value: "",
        value2: ""
      };
    }
    return { ...row };
  }

  protected rebuild(state: ConditionBuilderState): void {
    const list = this.refs.list;
    list.innerHTML = "";

    if (!state.rows.length) {
      list.appendChild(
        el("div", "hint", "No conditions \u2014 e.g. Assigned-to is empty OR State is In Progress")
      );
      return;
    }

    state.rows.forEach((row, i) => {
      list.appendChild(this.renderRow(row, i, state.table));
    });
  }

  protected renderRow(row: ConditionRow, index: number, table: string): HTMLElement {
    const def = this.deps.fields.find((f) => f.key === row.field);
    if (!def) throw new Error(`Condition ${index + 1}: unknown column`);

    const wrap = el("div", "crow flex gap-1 mt-1.5 items-center");
    if (index > 0) wrap.appendChild(this.joinSelector(row, index));
    wrap.appendChild(this.fieldSelector(row, index, table));
    wrap.appendChild(this.opSelector(row, def, index));
    if (!NO_VALUE_OPS.includes(row.op)) wrap.appendChild(this.valueWidget(row, def, index));
    wrap.appendChild(this.deleteButton(index));
    return wrap;
  }

  /**
   * Replaces one row and notifies.
   *
   * Safe for value edits: `patch` compares row *shapes*, so changing a value
   * never rebuilds the rows and the caret stays where the user left it.
   */
  protected update(index: number, patch: Partial<ConditionRow>): void {
    const rows = this.getState().rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
    this.setState({ rows });
    this.emit("change");
  }

  protected joinSelector(row: ConditionRow, index: number): HTMLElement {
    const select = el("select", "cjoin flex-none w-[62px] font-semibold text-accent text-xs px-1.5 py-1 min-w-0 bg-card2 text-text border border-line rounded");
    for (const [value, label] of [
      ["AND", "AND"],
      ["OR", "OR"]
    ] as [string, string][]) {
      const option = el("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
    select.value = row.join || "AND";
    select.addEventListener("change", () => {
      this.update(index, { join: select.value === "OR" ? "OR" : "AND" });
    });
    return select;
  }

  protected fieldSelector(row: ConditionRow, index: number, table: string): HTMLElement {
    const select = el("select", "cfield flex-[1.3] min-w-0 text-xs px-1.5 py-1 bg-card2 text-text border border-line rounded");
    for (const f of this.allowedFields(table)) {
      const option = el("option");
      option.value = f.key;
      option.textContent = f.label;
      select.appendChild(option);
    }
    select.value = row.field;
    select.addEventListener("change", () => {
      const def = this.deps.fields.find((f) => f.key === select.value);
      const op = (COND_OPS[def?.type || "ref"][0] || [])[0] || "";
      this.update(index, { field: select.value, op, value: "", value2: "" });
    });
    return select;
  }

  protected opSelector(row: ConditionRow, def: CondFieldDef, index: number): HTMLElement {
    const select = el("select", "cop flex-1 min-w-0 text-xs px-1.5 py-1 bg-card2 text-text border border-line rounded");
    for (const [value, label] of COND_OPS[def.type] || []) {
      const option = el("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
    select.value = row.op;
    select.addEventListener("change", () => {
      this.update(index, { op: select.value, value: "", value2: "" });
    });
    return select;
  }

  protected valueWidget(row: ConditionRow, def: CondFieldDef, index: number): HTMLElement {
    if (def.type === "choice") {
      const select = el("select", "cval flex-[1.2] min-w-0 text-xs px-1.5 py-1 bg-card2 text-text border border-line rounded");
      const list = this.deps.choiceList(def.choicesKey || "");
      for (const choice of list) {
        const option = el("option");
        option.value = String(choice.value);
        option.textContent = choice.label;
        select.appendChild(option);
      }
      if (!list.length) {
        const option = el("option");
        option.textContent = "(no values)";
        select.appendChild(option);
      }
      select.value = row.value || (list.length ? String(list[0].value) : "");
      if (!row.value && select.value) this.update(index, { value: select.value });
      select.addEventListener("change", () => this.update(index, { value: select.value }));
      return select;
    }

    const input = el("input", "cval flex-[1.2] min-w-0 text-xs px-1.5 py-1 bg-card2 text-text border border-line rounded") as HTMLInputElement;
    input.type = def.type === "date" ? "date" : "text";
    input.placeholder = def.type === "date" ? "" : "value";
    input.value = row.value || "";
    input.addEventListener("input", () => {
      // State only — no re-render, or the caret would jump on every keystroke.
      this.update(index, { value: input.value });
    });

    if (def.type === "date" && row.op === "between") {
      const second = el("input", "cval flex-[1.2] min-w-0 text-xs px-1.5 py-1 bg-card2 text-text border border-line rounded") as HTMLInputElement;
      second.type = "date";
      second.value = row.value2 || "";
      second.addEventListener("input", () => this.update(index, { value2: second.value }));
      const span = el("span");
      span.append(input, second);
      return span;
    }

    return input;
  }

  protected deleteButton(index: number): HTMLElement {
    const button = el("button", "cdel flex-none bg-transparent border-0 text-bad cursor-pointer px-1 py-0.5 text-[13px]", "\u2715");
    button.type = "button";
    setTip(button, "Remove condition");
    button.addEventListener("click", () => {
      const rows = this.getState().rows.filter((_, i) => i !== index);
      this.setState({
        rows: rows.map((r, j) => (j > 0 && !r.join ? { ...r, join: "AND" as const } : r))
      });
      this.emit("change");
    });
    return button;
  }

}

/** Identity of the row shapes, ignoring values. Changes force a rebuild. */
function shapeOf(state: ConditionBuilderState): string {
  return `${state.table}|${state.rows.map((r) => `${r.join}:${r.field}:${r.op}`).join(",")}`;
}

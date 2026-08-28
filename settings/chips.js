import { normalizeNames, parseNameLines } from "../lib/names.js";

export function splitTerms(text) {
  return parseNameLines(String(text ?? "").replace(/[\n,;]+/g, "\n"));
}

const el = tag => document.createElement(tag);

export function createChipList(root, { placeholder = "", collapsible = false } = {}) {
  if (!root) throw new Error("createChipList: missing root element");
  if (root.__chipInput) return root.__chipInput;
  root.classList.add("chipField");

  let values = [];
  let editing = false;

  const list = el("div");
  list.className = "chipList";
  const input = el("input");
  input.className = "chipInput";
  input.placeholder = placeholder || "Type a value and press Enter";

  let card = null;
  let count = null;
  let editBtn = null;
  let stack = null;
  let emptyHint = null;
  let textarea = null;
  let editor = null;

  if (collapsible) {
    count = el("span");
    count.className = "chipCount";
    editBtn = el("button");
    editBtn.type = "button";
    editBtn.className = "chipEditBtn";
    editBtn.textContent = "Edit";
    editBtn.title = "Edit these values";

    const head = el("div");
    head.className = "chipCardHead";
    head.append(count, editBtn);

    stack = el("div");
    stack.className = "chipStack";
    emptyHint = el("div");
    emptyHint.className = "chipEmpty";
    emptyHint.textContent = "None — Edit to add";

    textarea = el("textarea");
    textarea.className = "chipTextarea";
    textarea.placeholder = placeholder || "One value per line — commas/semicolons also split";

    const saveBtn = el("button");
    saveBtn.type = "button";
    saveBtn.className = "primary";
    saveBtn.textContent = "Save";
    const cancelBtn = el("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "Cancel";
    const actions = el("div");
    actions.className = "chipActions";
    actions.append(saveBtn, cancelBtn);

    editor = el("div");
    editor.className = "chipEditor";
    editor.append(textarea, actions);

    card = el("div");
    card.className = "chipCard";
    card.append(head, stack, emptyHint, editor);
    root.appendChild(card);

    editBtn.addEventListener("click", () => {
      editing = true;
      render();
      textarea.focus();
      textarea.select();
    });
    saveBtn.addEventListener("click", () => {
      values = splitTerms(textarea.value);
      editing = false;
      render();
    });
    cancelBtn.addEventListener("click", () => {
      editing = false;
      render();
    });
    textarea.addEventListener("keydown", ev => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        editing = false;
        render();
      }
    });
  } else {
    root.append(list, input);
  }

  const commitInput = () => {
    const terms = splitTerms(input.value);
    if (terms.length) {
      values = normalizeNames([...values, ...terms]);
      input.value = "";
      render();
    }
  };
  input.addEventListener("keydown", ev => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      commitInput();
    } else if (ev.key === "Backspace" && !input.value && values.length) {
      values = values.slice(0, -1);
      render();
    }
  });
  input.addEventListener("blur", commitInput);
  input.addEventListener("paste", ev => {
    const txt = ev.clipboardData ? ev.clipboardData.getData("text") : "";
    if (!txt || !/[\n,;]/.test(txt)) return;
    ev.preventDefault();
    const terms = splitTerms(txt);
    if (terms.length) {
      values = normalizeNames([...values, ...terms]);
      render();
    }
  });

  const render = () => {
    if (!collapsible) {
      list.innerHTML = "";
      for (const v of values) {
        const chip = el("div");
        chip.className = "chip";
        const lbl = el("span");
        lbl.className = "lbl";
        lbl.textContent = v;
        const rm = el("button");
        rm.type = "button";
        rm.className = "rm";
        rm.textContent = "✕";
        rm.title = "Remove";
        rm.addEventListener("click", () => {
          values = normalizeNames(values.filter(x => x.toLowerCase() !== v.toLowerCase()));
          render();
        });
        chip.append(lbl, rm);
        list.appendChild(chip);
      }
      return;
    }
    count.textContent = `${values.length} value${values.length === 1 ? "" : "s"}`;
    stack.innerHTML = "";
    for (const v of values) {
      const row = el("div");
      row.className = "chipRow";
      row.textContent = v;
      stack.appendChild(row);
    }
    stack.hidden = editing;
    emptyHint.hidden = editing || values.length > 0;
    editor.hidden = !editing;
    editBtn.hidden = editing;
    if (editing) textarea.value = values.join("\n");
  };

  root.__chipInput = {
    getValues: () => values.slice(),
    setValues: arr => {
      values = normalizeNames(arr || []);
      render();
    }
  };
  render();
  return root.__chipInput;
}
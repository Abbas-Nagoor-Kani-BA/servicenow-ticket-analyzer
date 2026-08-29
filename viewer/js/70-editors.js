import { $, columnOptionList, visibleCols } from "./00-core.js";
import { SearchPicker } from "../../components/search-picker.ts";
import { displayedValue, findRowBySysId, parseLocalInput, render, scheduleSave } from "./30-grid.js";
import { applySelHighlight, moveSel } from "./40-selection.js";

let activeFinish = null;

import { activityPaneEl } from "./60-activity.js";


function createOptionPicker(td, row, key) {
  const options = columnOptionList(key, row);
  const cur = String(row[key] ?? "");
  const withNotes = key === "rootCause" || key === "solutionType";

  const commitValue = (value, intent) => {
    row[key] = value;
    td.parentElement.classList.add("flash");
    scheduleSave();
    render();
    applySelHighlight();
    if (intent === "tab") moveSel(0, 1, false);
    else if (intent === "tab-back") moveSel(0, -1, false);
    else moveSel(1, 0, false);
  };

  const picker = new SearchPicker(document.body, {}, {
    anchor: td,
    options,
    current: cur,
    minWidth: withNotes ? 640 : 280,
    aside: withNotes ? activityPaneEl(row) : null,
    repositionOn: $("wrap"),
    onPick: commitValue,
    onDismiss: () => {
      render();
      applySelHighlight();
    }
  });

  /** @type {((commit: boolean, move?: object) => boolean) & { done?: boolean }} */
  const finish = (commit, move) => {
    if (finish.done) return true;
    let ok = true;
    if (commit) ok = picker.commitNow();
    else picker.cancelNow();
    finish.done = true;
    activeFinish = null;
    return ok;
  };
  return finish;
}

function createTextInput(td, row, key, cls) {
  td.classList.add("edit-input");
  const editor = document.createElement("input");
  editor.value = displayedValue(row, key, cls);
  td.textContent = "";
  td.appendChild(editor);
  editor.focus();
  editor.select();

  /** @type {((commit: boolean, move: object | undefined) => boolean) & { done?: boolean, reparsed?: string }} */
  const finish = (commit, move) => {
    if (finish.done) return true;
    let parsed = editor.value;
    if (commit && cls === "inst") {
      const t = parsed.trim();
      const d = parseLocalInput(t);
      if (!d && t) {
        td.classList.add("edit-invalid");
        return false;
      }
      parsed = d ? d.toISOString() : "";
    }
    finish.done = true;
    activeFinish = null;
    editor.removeEventListener("keydown", onKey);
    editor.removeEventListener("blur", onBlur);
    td.classList.remove("edit-input", "edit-invalid");
    editor.remove();
    if (commit) {
      row[key] = parsed;
      td.parentElement.classList.add("flash");
      scheduleSave();
    }
    render();
    applySelHighlight();
    if (commit && move) moveSel(move.r, move.c, false);
    return true;
  };

  const onKey = e => {
    if (e.key === "Enter") { e.preventDefault(); finish(true, { r: 1, c: 0 }); }
    else if (e.key === "Tab") { e.preventDefault(); finish(true, { r: 0, c: e.shiftKey ? -1 : 1 }); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
  };
  const onBlur = () => { finish(true); };

  editor.addEventListener("keydown", onKey);
  editor.addEventListener("blur", onBlur);
  return finish;
}

function startEdit(td) {
  if (!td.classList.contains("editable")) return;
  if (activeFinish && !activeFinish(true)) return;
  const tr = td.parentElement;
  const sysId = tr.dataset.sysId;
  const row = findRowBySysId(sysId);
  if (!row) return;
  const cols = visibleCols();
  const idx = [...tr.children].indexOf(td);
  if (idx < 0 || idx >= cols.length) return;
  const [key,, cls] = cols[idx];
  if (!key || key === "number") return;

  const options = columnOptionList(key, row);
  if (options && options.length) {
    activeFinish = createOptionPicker(td, row, key);
  } else {
    activeFinish = createTextInput(td, row, key, cls);
  }
}

export {
  startEdit
};

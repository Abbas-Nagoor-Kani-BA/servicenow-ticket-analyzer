import { $, columnOptionList, el, placePopupNear, visibleCols } from "./00-core.js";
import { displayedValue, findRowBySysId, parseLocalInput, render, scheduleSave } from "./30-grid.js";
import { applySelHighlight, moveSel } from "./40-selection.js";

let activeFinish = null;

import { activityPaneEl } from "./60-activity.js";


function createOptionPicker(td, row, key) {
  const options = columnOptionList(key, row);
  const cur = String(row[key] ?? "");
  const entries = ["", ...options];
  if (cur && !options.some(x => x.toLowerCase() === cur.toLowerCase())) entries.push(cur);
  const labelOf = v =>
    v === "" ? "— clear —"
      : v + (cur && v === cur && !options.some(x => x.toLowerCase() === cur.toLowerCase()) ? " · current" : "");
  const baseLabel = v => (v === "" ? "— clear —" : v);
  const acronymOf = s =>
    s.split(/[\s\-\/_,]+/).filter(Boolean).map(w => w[0]).join("").toLowerCase();

  let picked;
  let listItems = [];
  let activeIdx = 0;
  let firstOpen = true;

  const pop = document.createElement("div");
  const withNotes = key === "rootCause" || key === "solutionType";
  pop.className = "msrPick" + (withNotes ? " wide" : "");
  const searchIn = document.createElement("input");
  searchIn.className = "msrPickSearch";
  searchIn.placeholder = "Search or type initials\u2026";
  searchIn.autocomplete = "off";
  searchIn.spellcheck = false;
  const listEl = document.createElement("div");
  listEl.className = "msrPickList";
  const foot = document.createElement("div");
  foot.className = "msrPickFoot";
  if (withNotes) {
    const mainCol = el("div", "msrPickMain");
    mainCol.append(searchIn, listEl, foot);
    pop.append(mainCol, activityPaneEl(row));
  } else {
    pop.append(searchIn, listEl, foot);
  }

  const applyFilter = () => {
    const refVal = firstOpen ? cur : searchIn.value;
    const q = firstOpen ? "" : searchIn.value.trim().toLowerCase();
    if (!q) {
      listItems = entries.slice();
    } else {
      const acros = [];
      const subs = [];
      for (const v of entries) {
        const hay = labelOf(v).toLowerCase();
        if (q.length >= 2 && acronymOf(baseLabel(v)).startsWith(q)) acros.push(v);
        else if (hay.includes(q)) subs.push(v);
      }
      listItems = [...acros, ...subs];
    }
    const exact = listItems.findIndex(v => v.toLowerCase() === refVal.trim().toLowerCase());
    activeIdx = exact >= 0 ? exact : 0;
  };
  const paint = () => {
    listEl.innerHTML = "";
    foot.textContent = `${listItems.length} option${listItems.length === 1 ? "" : "s"} \xB7 \u2191\u2193 \xB7 Enter \xB7 Esc`;
    if (!listItems.length) {
      const d = el("div", "msrPickItem none");
      d.textContent = "No matching option";
      listEl.appendChild(d);
      return;
    }
    listItems.forEach((v, i) => {
      const d = document.createElement("div");
      d.className = "msrPickItem" + (i === activeIdx ? " active" : "");
      d.textContent = labelOf(v);
      d.addEventListener("pointerdown", ev => {
        ev.preventDefault();
        picked = v;
        finish(true, { r: 1, c: 0 });
      });
      listEl.appendChild(d);
    });
    const act = listEl.children[activeIdx];
    if (act) {
      const top = act.offsetTop, view = listEl.clientHeight;
      if (top < listEl.scrollTop || top + act.offsetHeight > listEl.scrollTop + view) {
        listEl.scrollTop = Math.max(0, top - view / 2);
      }
    }
  };
  const renderList = () => {
    applyFilter();
    paint();
  };

  const placePop = () => {
    if (!pop.isConnected) return;
    const r = td.getBoundingClientRect();
    placePopupNear(pop, r, withNotes ? 640 : 280);
  };

  const flashInvalid = () => {
    searchIn.classList.add("invalid");
    setTimeout(() => searchIn.classList.remove("invalid"), 450);
  };
  const tryCommit = () => {
    if (!listItems.length) return false;
    const q = searchIn.value.trim().toLowerCase();
    const exact = firstOpen ? undefined : listItems.find(v => v.toLowerCase() === q);
    picked = exact !== undefined ? exact : listItems[activeIdx];
    return true;
  };

  const finish = (commit, move) => {
    if (finish.done) return true;
    finish.done = true;
    activeFinish = null;
    searchIn.removeEventListener("keydown", onKey);
    searchIn.removeEventListener("blur", onBlur);
    searchIn.removeEventListener("input", onInput);
    $("wrap").removeEventListener("scroll", onScroll);
    pop.remove();
    if (commit) {
      row[key] = picked !== undefined ? picked : row[key];
      td.parentElement.classList.add("flash");
      scheduleSave();
    }
    render();
    applySelHighlight();
    if (commit && move) moveSel(move.r, move.c, false);
    return true;
  };

  const onKey = e => {
    if (e.key === "ArrowDown" && listItems.length) {
      e.preventDefault();
      activeIdx = (activeIdx + 1) % listItems.length;
      paint();
    } else if (e.key === "ArrowUp" && listItems.length) {
      e.preventDefault();
      activeIdx = (activeIdx - 1 + listItems.length) % listItems.length;
      paint();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (tryCommit()) finish(true, { r: 1, c: 0 });
      else flashInvalid();
    } else if (e.key === "Tab") {
      e.preventDefault();
      if (tryCommit()) finish(true, { r: 0, c: e.shiftKey ? -1 : 1 });
      else flashInvalid();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  };
  const onBlur = () => {
    setTimeout(() => { if (picked === undefined && pop.isConnected) finish(false); }, 0);
  };
  const onInput = () => {
    firstOpen = false;
    renderList();
  };
  const onScroll = () => placePop();

  searchIn.addEventListener("keydown", onKey);
  searchIn.addEventListener("blur", onBlur);
  searchIn.addEventListener("input", onInput);
  $("wrap").addEventListener("scroll", onScroll);

  document.body.appendChild(pop);
  renderList();
  placePop();
  searchIn.focus();
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

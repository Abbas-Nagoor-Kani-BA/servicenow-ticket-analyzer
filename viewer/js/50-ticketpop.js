import * as MsrChoices from "../../lib/msrchoices.js";
import { el, placePopupNear, setStatus } from "./00-core.js";
import { getMsrLists } from "./00-store.js";
import { applyPickFilter, paintPickItems, pickCurNotInOptions, pickLabelOf } from "./15-picker.js";
import { displayedValue, fmtInstant, parseLocalInput, render, scheduleSave } from "./30-grid.js";


let ticketPopState = null;

function closeTicketPopup() {
  if (!ticketPopState) return;
  const { pop, cleanup } = ticketPopState;
  ticketPopState = null;
  cleanup();
  pop.remove();
}

function paneHead(text) {
  const h = el("div", "paneHead");
  h.textContent = text;
  return h;
}

let nestedPickState = null;

function closeNestedPick() {
  if (!nestedPickState) return;
  const { pop, cleanup } = nestedPickState;
  nestedPickState = null;
  cleanup();
  pop.remove();
}

function attachSearchPick(anchorInput, options, currentValue, onPick) {
  closeNestedPick();
  const cur = String(currentValue ?? "");
  const entries = ["", ...options];
  if (cur && !options.some(x => x.toLowerCase() === cur.toLowerCase())) entries.push(cur);
  const curNotInOptions = pickCurNotInOptions(options, cur);

  const pop = el("div", "msrPick pickNested");
  const sIn = document.createElement("input");
  sIn.className = "msrPickSearch";
  sIn.placeholder = "Search or type initials\u2026";
  sIn.autocomplete = "off";
  sIn.spellcheck = false;
  const listEl = el("div", "msrPickList");
  const foot = el("div", "msrPickFoot");
  pop.append(sIn, listEl, foot);

  let items = [];
  let activeIdx = 0;

  const renderItem = v => {
    const d = document.createElement("div");
    d.textContent = pickLabelOf(v, cur, curNotInOptions);
    d.addEventListener("pointerdown", ev => {
      ev.preventDefault();
      closeNestedPick();
      onPick(v);
    });
    return d;
  };
  const paint = () => paintPickItems(listEl, foot, items, activeIdx, renderItem);
  const applyFilter = () => {
    const q = firstOpen ? "" : sIn.value.trim().toLowerCase();
    const res = applyPickFilter(entries, q, firstOpen ? cur : sIn.value, cur);
    items = res.items;
    activeIdx = res.activeIdx;
  };
  let firstOpen = true;
  const renderList = () => {
    applyFilter();
    paint();
  };
  const place = () => {
    if (!pop.isConnected) return;
    placePopupNear(pop, anchorInput.getBoundingClientRect(), 300);
  };
  const onKey = e => {
    if (e.key === "ArrowDown" && items.length) { e.preventDefault(); activeIdx = (activeIdx + 1) % items.length; paint(); }
    else if (e.key === "ArrowUp" && items.length) { e.preventDefault(); activeIdx = (activeIdx - 1 + items.length) % items.length; paint(); }
    else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (!items.length) return;
      const v = items[activeIdx];
      closeNestedPick();
      onPick(v);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeNestedPick();
    }
  };
  const onBlur = () => { setTimeout(() => { if (!pickedFlag()) closeNestedPick(); }, 0); };
  const pickedFlag = () => false;
  const onDocDown = e => {
    if (!pop.contains(e.target) && e.target !== anchorInput) closeNestedPick();
  };
  const cleanup = () => {
    sIn.removeEventListener("keydown", onKey);
    sIn.removeEventListener("blur", onBlur);
    sIn.removeEventListener("input", onInput);
    document.removeEventListener("mousedown", onDocDown, true);
  };
  const onInput = () => { firstOpen = false; renderList(); };

  sIn.addEventListener("keydown", onKey);
  sIn.addEventListener("blur", onBlur);
  sIn.addEventListener("input", onInput);
  document.addEventListener("mousedown", onDocDown, true);

  document.body.appendChild(pop);
  renderList();
  place();
  sIn.focus();
  nestedPickState = { pop, cleanup };
}

function buildTicketLeftPane(row, placePop) {
  const left = el("div", "ticketCol");
  left.appendChild(paneHead("Incident"));
  const numberLine = el("div", "fieldLine");
  const numLab = el("span", "fl");
  numLab.textContent = "Number";
  const numVal = el("span", "fv");
  numVal.textContent = String(row.number ?? "");
  numberLine.append(numLab, numVal);
  left.appendChild(numberLine);
  const EDIT_FIELDS = [
    ["solutionType", "Solution type"], ["rootCause", "Root cause category"]
  ];
  for (const [k, lab] of EDIT_FIELDS) {
    const line = el("div", "fieldLine");
    const l = el("span", "fl");
    l.textContent = lab;
    const wrap = el("div", "fvWrap");
    const input = document.createElement("input");
    input.className = "fvEdit";
    input.value = String(row[k] ?? "");
    input.readOnly = true;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.placeholder = "Click to choose\u2026";
    const options = k === "solutionType"
      ? getMsrLists().resolution
      : MsrChoices.rootCauseFor(getMsrLists().rootCause, MsrChoices.msrType(row.number));
    input.addEventListener("focus", () => {
      attachSearchPick(input, options, row[k], v => {
        input.value = v;
        if (v !== String(row[k] ?? "")) {
          row[k] = v;
          scheduleSave();
          setStatus(lab + " saved");
          render();
          placePop();
        }
      });
    });
    wrap.append(input);
    line.append(l, wrap);
    left.appendChild(line);
  }

  const TL = [
    ["assignTime", "Assigned"], ["acknTime", "Acknowledged"],
    ["suspendTime", "Suspended"], ["resumeTime", "Resumed"]
  ];
  for (const [k, lab] of TL) {
    const line = el("div", "fieldLine");
    const l = el("span", "fl");
    l.textContent = lab;
    const wrap = el("div", "fvWrap");
    const input = document.createElement("input");
    input.className = "fvEdit tlDate";
    input.value = displayedValue(row, k, "inst");
    input.spellcheck = false;
    input.autocomplete = "off";
    const commit = () => {
      const v = input.value.trim();
      const d = parseLocalInput(v);
      if (!d && v) {
        input.classList.add("invalid");
        setTimeout(() => input.classList.remove("invalid"), 500);
        return false;
      }
      const next = d ? d.toISOString() : "";
      if (next !== (row[k] || "")) {
        row[k] = next;
        scheduleSave();
        setStatus("Timeline " + lab.toLowerCase() + " saved");
        render();
        placePop();
      }
      return true;
    };
    input.addEventListener("keydown", ev => {
      if (ev.key === "Enter") { ev.preventDefault(); commit(); }
      else if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        input.value = displayedValue(row, k, "inst");
        closeTicketPopup();
      }
    });
    input.addEventListener("blur", () => commit());
    wrap.append(input);
    line.append(l, wrap);
    left.appendChild(line);
  }

  return left;
}

function buildTicketRightPane(row) {
  const right = el("div", "ticketCol");
  const summary = String(row.shortDescription || "").trim();
  if (summary) {
    right.appendChild(paneHead("Summary"));
    const s = el("div", "trRow");
    const st = el("div", "trText");
    st.textContent = summary;
    s.appendChild(st);
    right.appendChild(s);
  }
  right.appendChild(paneHead("Transitions \xB7 queue / assigned to / state"));
  const TRIO = { assignment_group: "Queue", assigned_to: "Assigned to", state: "State" };
  const evs = (row.activity || [])
    .filter(e => TRIO[e.f])
    .sort((a, b) => b.at - a.at);
  if (!Array.isArray(row.activity)) {
    const d = el("div", "noteEmpty");
    d.textContent = "Transitions load on the next pull \u2014 this data was fetched before activity tracking was added.";
    right.appendChild(d);
  } else if (!evs.length) {
    const d = el("div", "noteEmpty");
    d.textContent = "No queue / assignee / state transitions recorded for this ticket.";
    right.appendChild(d);
  }
  for (const e of evs) {
    const r = el("div", "trRow");
    const dt = el("span", "trDate");
    dt.textContent = fmtInstant(new Date(e.at).toISOString(), row);
    const txt = el("div", "trText");
    txt.textContent = TRIO[e.f] + ": " + (e.o || "(empty)") + " \u2192 " + (e.n || "(empty)");
    r.append(dt, txt);
    right.appendChild(r);
  }
  return right;
}

function openTicketPopup(row) {
  closeTicketPopup();
  const pop = el("div", "msrPick ticketPop");

  const placePop = () => {
    if (!pop.isConnected) return;
    const w = Math.min(760, window.innerWidth - 24);
    pop.style.width = w + "px";
    pop.style.left = Math.max(8, (window.innerWidth - w) / 2) + "px";
    const h = pop.offsetHeight || 480;
    pop.style.top = Math.max(8, (window.innerHeight - h) / 2) + "px";
  };

  pop.append(buildTicketLeftPane(row, placePop), buildTicketRightPane(row));

  const onDocDown = e => {
    if (!pop.contains(e.target) && !(e.target.closest && e.target.closest(".msrPick"))) closeTicketPopup();
  };
  const onDocKey = e => {
    if (e.key === "Escape") {
      if (e.target && e.target.closest && e.target.closest(".msrPick")) return;
      if (e.target && pop.contains(e.target) && e.target.tagName === "INPUT") return;
      e.preventDefault();
      e.stopPropagation();
      closeTicketPopup();
    }
  };
  const cleanup = () => {
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("keydown", onDocKey, true);
  };

  document.body.appendChild(pop);
  document.addEventListener("mousedown", onDocDown, true);
  document.addEventListener("keydown", onDocKey, true);
  placePop();
  ticketPopState = { pop, cleanup };
}

export {
  closeTicketPopup,
  paneHead,
  closeNestedPick,
  attachSearchPick,
  openTicketPopup,
  ticketPopState,
  nestedPickState
};

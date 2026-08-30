import * as MsrChoices from "../../core/msrchoices.ts";
import { el, setStatus } from "./core.ts";
import type { ViewerRow } from "./core.ts";
import { SearchPicker } from "../../components/search-picker.ts";
import { getMsrLists } from "./store.ts";
import { displayedValue, fmtInstant, parseLocalInput, render, scheduleSave } from "./grid.ts";

type TrEv = { f?: unknown; o?: unknown; n?: unknown; at?: unknown; atEpoch?: unknown };

let ticketPopState: { pop: HTMLElement; cleanup: () => void } | null = null;

function closeTicketPopup(): void {
  if (!ticketPopState) return;
  const { pop, cleanup } = ticketPopState;
  ticketPopState = null;
  cleanup();
  pop.remove();
}

function paneHead(text: string): HTMLElement {
  const h = el("div", "paneHead");
  h.textContent = text;
  return h;
}

let nestedPickState: SearchPicker | null = null;

function closeNestedPick(): void {
  if (!nestedPickState) return;
  const picker = nestedPickState;
  nestedPickState = null;
  picker.close();
}

function attachSearchPick(anchorInput: HTMLElement, options: string[], currentValue: unknown, onPick: (v: string) => void): void {
  closeNestedPick();
  nestedPickState = new SearchPicker(document.body, {}, {
    anchor: anchorInput,
    options,
    current: String(currentValue ?? ""),
    minWidth: 300,
    onPick: (value) => {
      nestedPickState = null;
      onPick(value);
    },
    onDismiss: () => {
      nestedPickState = null;
    }
  });
}

function buildTicketLeftPane(row: ViewerRow, placePop: () => void): HTMLElement {
  const left = el("div", "ticketCol");
  left.appendChild(paneHead("Incident"));
  const numberLine = el("div", "fieldLine");
  const numLab = el("span", "fl");
  numLab.textContent = "Number";
  const numVal = el("span", "fv");
  numVal.textContent = String(row.number ?? "");
  numberLine.append(numLab, numVal);
  left.appendChild(numberLine);
  const EDIT_FIELDS: Array<[string, string]> = [
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

  const TL: Array<[string, string]> = [
    ["assignTimeUtcIso", "Assigned"], ["acknTimeUtcIso", "Acknowledged"],
    ["suspendTimeUtcIso", "Suspended"], ["resumeTimeUtcIso", "Resumed"]
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
    const commit = (): boolean => {
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

function buildTicketRightPane(row: ViewerRow): HTMLElement {
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
  const TRIO: Record<string, string> = { assignment_group: "Queue", assigned_to: "Assigned to", state: "State" };
  const evs = ((row.activity as TrEv[] | undefined) || [])
    .filter(e => TRIO[String(e.f)] !== undefined)
    .sort((a, b) =>
      Number(b.atEpoch ?? b.at ?? 0) - Number(a.atEpoch ?? a.at ?? 0));
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
    const eAt: number | unknown = Number.isFinite(e.atEpoch as number) ? (e.atEpoch as number) : e.at;
    const iso = eAt !== undefined && eAt !== null && eAt !== "" && !Number.isNaN(eAt as number)
      ? new Date(eAt as number).toISOString() : "";
    dt.textContent = iso ? fmtInstant(iso, row) : "";
    const txt = el("div", "trText");
    txt.textContent = TRIO[String(e.f)] + ": " + (e.o || "(empty)") + " \u2192 " + (e.n || "(empty)");
    r.append(dt, txt);
    right.appendChild(r);
  }
  return right;
}

function openTicketPopup(row: ViewerRow): void {
  closeTicketPopup();
  const pop = el("div", "msrPick ticketPop");

  const placePop = (): void => {
    if (!pop.isConnected) return;
    const w = Math.min(760, window.innerWidth - 24);
    pop.style.width = w + "px";
    pop.style.left = Math.max(8, (window.innerWidth - w) / 2) + "px";
    const h = pop.offsetHeight || 480;
    pop.style.top = Math.max(8, (window.innerHeight - h) / 2) + "px";
  };

  pop.append(buildTicketLeftPane(row, placePop), buildTicketRightPane(row));

  const onDocDown = (e: MouseEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && !pop.contains(t) && !(t.closest && t.closest(".msrPick"))) closeTicketPopup();
  };
  const onDocKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      const t = e.target as HTMLElement | null;
      if (t && t.closest && t.closest(".msrPick")) return;
      if (t && pop.contains(t) && t.tagName === "INPUT") return;
      e.preventDefault();
      e.stopPropagation();
      closeTicketPopup();
    }
  };
  const cleanup = (): void => {
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
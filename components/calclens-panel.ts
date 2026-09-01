import { Component, el } from "./component.ts";
import type { ComponentProps } from "./component.ts";
import type { Explanation, SlDigest, TimelineStep } from "../core/calclens.ts";
import { icon, iconButton } from "../lib/icons.ts";
import { SearchPicker } from "./search-picker.ts";

/** Appends `s` to `node`, turning `**emphasis**` pairs into `<strong class="step-em">`.
 *  Built with text nodes (never innerHTML) because steps interpolate row values. */
function appendInline(node: Node, s: string): void {
  const parts = s.split(/\*\*(.+?)\*\*/g);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "") continue;
    if (i % 2 === 1) {
      const strong = document.createElement("strong");
      strong.className = "step-em";
      strong.textContent = p;
      node.appendChild(strong);
    } else {
      node.appendChild(document.createTextNode(p));
    }
  }
}

export type CalclensPanelState = {
  open: boolean;
  explanation: Explanation | null;
  /** The currently-selected cell the drawer may offer editing for. */
  edit: CalclensEdit | null;
};

export type CalclensEdit = {
  row: Record<string, any>;
  key: string;
  cls: string;
};

export type CalclensPanelDeps = {
  /** Runs after the drawer is closed by the X button. */
  onClosed?: () => void;
  /** Option list for a choice column, or null if it is not a choice column. */
  optionsFor?: (key: string, row: Record<string, any>) => string[] | null;
  /** Display value for a cell (instance formatter for "inst" cells). */
  displayFor?: (key: string, row: Record<string, any>, cls: string) => string;
  /** Parses a local-date input string to a UTC Date; null if unparseable. */
  parseValue?: (v: string, key: string) => Date | null;
  /** Extra notes pane for the picker (rootCause/solutionType). */
  activityFor?: (row: Record<string, any>) => HTMLElement | null;
  /** Writes an edited value back to the row and persists. */
  onCommit?: (key: string, value: string, row: Record<string, any>) => void;
};

/** The only grid columns editable from the drawer (the derivation columns). */
const EDITABLE_CHOICE = new Set(["solutionType", "rootCause"]);
const EDITABLE_INST = new Set(["assignTimeUtcIso", "acknTimeUtcIso", "suspendTimeUtcIso", "resumeTimeUtcIso"]);

/**
 * The Calclens right-side drawer: shows how the currently-selected cell's value
 * was derived, and (for the derivation columns) lets the user edit it in place.
 * Built once; `patch` swaps the explanation content when the selection changes,
 * so typing/scroll elsewhere is never disturbed.
 */
export class CalclensPanel extends Component<CalclensPanelState, ComponentProps, CalclensPanelDeps> {
  private timeInput: HTMLInputElement | null = null;
  private timeListEl: HTMLElement | null = null;
  private tlEvents: TimelineStep[] = [];
  private tlPickable: ((ev: TimelineStep) => void) | undefined;

  protected initialState(): CalclensPanelState {
    return { open: false, explanation: null, edit: null };
  }

  protected build(): void {
    this.root.classList.add("calclens-drawer");
    this.root.innerHTML = "";

    const head = el("div", "calclens-head");
    const title = el("span", "calclens-title", "Calclens");
    head.appendChild(title);
    const close = iconButton("x-circle", "Close", { cls: "calclens-close", size: 16 });
    close.addEventListener("click", () => this.close());
    head.appendChild(close);
    this.root.appendChild(head);

    const body = el("div", "calclens-body");
    body.id = "calclensBody";
    this.root.appendChild(body);
  }

  protected patch(next: CalclensPanelState): void {
    this.root.classList.toggle("open", next.open);
    const body = this.q<HTMLElement>(".calclens-body");
    if (!next.open) {
      body.innerHTML = "";
      return;
    }
    this.renderBody(body, next.explanation, next.edit);
  }

  private renderBody(body: HTMLElement, ex: Explanation | null, edit: CalclensEdit | null): void {
    body.innerHTML = "";
    if (!ex) {
      body.appendChild(el("div", "calclens-empty", "Select a cell to see how its value was derived."));
      return;
    }

    const badge = el("span", `calclens-badge kind-${ex.kind}`);
    badge.appendChild(icon(kindIconName(ex.kind) as any, "cb-badge-icn"));
    badge.appendChild(document.createTextNode(" " + ex.kind));
    body.appendChild(badge);

    const value = el("div", "calclens-value", ex.value || "\u2014");
    body.appendChild(value);

    if (ex.transition) {
      const t = el("div", "calclens-field calclens-transition");
      const arrow = icon("arrow-right" as any, "cb-trans-icn");
      arrow.style.display = "inline-block";
      const span = el("span", "calclens-field-value", ex.transition);
      span.prepend(arrow);
      t.appendChild(span);
      body.appendChild(t);
    }

    body.appendChild(fieldBlock("Summary", ex.summary));

    // The derived time editor sits right under the summary; the Timeline below
    // is the picker, so the user can click a row to choose its time.
    const isInstEdit = !!(edit && EDITABLE_INST.has(edit.key));
    if (isInstEdit) {
      body.appendChild(this.renderInstInput(edit.row, edit.key, edit.cls));
    }

    if (ex.digest) {
      body.appendChild(this.renderDigest(ex.digest));
    }

    if (ex.timeline && ex.timeline.length) {
      body.appendChild(this.renderTimeline(ex.timeline, isInstEdit ? (ev) => this.pickTimeline(edit, ev) : undefined));
    }

    if (ex.inputs && ex.inputs.length) {
      const wrap = el("div", "calclens-section");
      wrap.appendChild(el("div", "calclens-section-title", "Inputs"));
      const tbl = el("table", "calclens-inputs");
      const tbody = document.createElement("tbody");
      for (const inp of ex.inputs) {
        const tr = document.createElement("tr");
        const th = el("td", "calclens-input-label", inp.label);
        const td = el("td", "calclens-input-value", inp.value || "\u2014");
        tr.append(th, td);
        tbody.appendChild(tr);
      }
      tbl.appendChild(tbody);
      wrap.appendChild(tbl);
      body.appendChild(wrap);
    }

    if (ex.steps && ex.steps.length) {
      const wrap = el("div", "calclens-section");
      wrap.appendChild(el("div", "calclens-section-title", "How it was derived"));
      const list = el("ol", "calclens-steps");
      for (const s of ex.steps) {
        const li = el("li");
        appendInline(li, s);
        list.appendChild(li);
      }
      wrap.appendChild(list);
      body.appendChild(wrap);
    }

    if (ex.confidence) {
      body.appendChild(field("Confidence", ex.confidence));
    }

    if (ex.warnings && ex.warnings.length) {
      const wrap = el("div", "calclens-section calclens-warnings");
      wrap.appendChild(el("div", "calclens-section-title", "Notes"));
      for (const w of ex.warnings) {
        const li = el("div", "calclens-warning");
        li.appendChild(icon("triangle-alert" as any, "cb-warn-icn"));
        li.appendChild(document.createTextNode(" " + w));
        wrap.appendChild(li);
      }
      body.appendChild(wrap);
    }

    if (edit && EDITABLE_CHOICE.has(edit.key)) {
      body.appendChild(this.renderEdit(edit));
    }
  }

  private renderEdit(edit: CalclensEdit): HTMLElement {
    const { row, key } = edit;
    const wrap = el("div", "calclens-section calclens-edit");
    wrap.appendChild(el("div", "calclens-section-title", "Edit value"));
    wrap.appendChild(this.renderChoiceEditor(row, key));
    return wrap;
  }

  private renderChoiceEditor(row: Record<string, any>, key: string): HTMLElement {
    const options = this.deps.optionsFor?.(key, row) || [];
    const cur = String(row[key] ?? "");
    const input = el("input", "calclens-edit-input");
    input.value = cur;
    input.readOnly = true;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.placeholder = "Click to choose\u2026";

    input.addEventListener("focus", () => {
      const aside = (EDITABLE_CHOICE.has(key) && this.deps.activityFor)
        ? this.deps.activityFor(row)
        : null;
      new SearchPicker(document.body, {}, {
        anchor: input,
        options,
        current: cur,
        minWidth: aside ? 640 : 280,
        aside,
        repositionOn: this.root,
        onPick: (value) => {
          if (value !== String(row[key] ?? "")) {
            row[key] = value;
            this.deps.onCommit?.(key, String(value), row);
            this.repatch();
          }
        },
        onDismiss: () => undefined
      });
    });

    const note = el("div", "calclens-edit-hint", "Pick from the MSR list for this column.");
    const block = el("div", "calclens-edit-control");
    block.appendChild(input);
    block.appendChild(note);
    return block;
  }

  /** Pending derived-time edit: set when the user picks a timeline row or types
   *  in the date input, persisted only on exit / moving to the next cell. */
  private timeDraft: { row: Record<string, any>; key: string; cls: string; original: unknown; iso: string } | null = null;

  /** The derived-time date input, placed right under the summary line. Only the
   *  Save button commits — typing or clicking a timeline row just stages a draft. */
  private renderInstInput(row: Record<string, any>, key: string, cls: string): HTMLElement {
    const input = el("input", "calclens-edit-input tlDate");
    input.value = this.deps.displayFor?.(key, row, cls) ?? "";
    input.spellcheck = false;
    input.autocomplete = "off";
    this.timeInput = input;
    this.timeDraft = { row, key, cls, original: row[key] ?? "", iso: String(row[key] ?? "") };

    const save = (): void => {
      const d = this.timeDraft;
      if (!d) return;
      const iso = d.iso;
      if (iso === String(d.row[d.key] ?? "")) {
        this.timeDraft = null;
        return;
      }
      d.row[d.key] = iso;
      this.timeDraft = null;
      if (this.deps.onCommit) {
        this.deps.onCommit(d.key, iso, d.row);
        this.repatch();
      }
    };
    const cancel = (): void => {
      this.timeDraft = null;
      this.repatch();
    };
    input.addEventListener("input", () => {
      const v = input.value.trim();
      if (!v) {
        if (this.timeDraft) { this.timeDraft.iso = ""; }
        input.classList.remove("invalid");
        return;
      }
      const parsed = this.deps.parseValue ? this.deps.parseValue(v, this.timeDraft?.key ?? key) : null;
      if (!parsed) {
        input.classList.add("invalid");
      } else {
        input.classList.remove("invalid");
        if (this.timeDraft) this.timeDraft.iso = parsed.toISOString();
      }
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); cancel(); }
    });
    // Note: blur is intentionally NOT wired — only the Save button persists.

    const saveBtn = el("button", "calclens-edit-save");
    saveBtn.type = "button";
    saveBtn.appendChild(icon("check-circle-2" as any, "calclens-edit-save-icn"));
    saveBtn.appendChild(document.createTextNode(" Save"));
    saveBtn.addEventListener("click", save);

    const rowWrap = el("div", "calclens-edit-inputrow");
    rowWrap.appendChild(input);
    rowWrap.appendChild(saveBtn);

    const note = el("div", "calclens-edit-hint", "Enter a date/time in the instance clock, or click a row in the Timeline below. Click Save to apply.");
    const block = el("div", "calclens-edit-control");
    block.appendChild(rowWrap);
    block.appendChild(note);
    return block;
  }

  /** User picked a timeline row: stage the exact event time (no write to the row,
   *  no persist) and highlight that row. Only Save commits. */
  private pickTimeline(edit: CalclensEdit, ev: TimelineStep): void {
    if (!this.timeDraft) this.timeDraft = { row: edit.row, key: edit.key, cls: edit.cls, original: edit.row[edit.key] ?? "", iso: ev.atIso };
    const d = this.timeDraft;
    if (d.row !== edit.row) return;
    d.cls = edit.cls;
    d.iso = ev.atIso;
    if (this.timeInput) this.timeInput.value = ev.atLabel;
    if (this.timeListEl) this.paintTimeline(this.tlEvents, this.tlPickable);
  }

  /** Rebuilds only the Timeline list so the picked group is highlighted. Events
   *  that share a timestamp are grouped under one node; each sub-change shows its
   *  own field icon. Selection is derived from the draft ISO so Escape / cell-change reverts. */
  private paintTimeline(events: TimelineStep[], pickable?: (ev: TimelineStep) => void): void {
    if (!this.timeListEl) return;
    this.timeListEl.innerHTML = "";
    const draftIso = this.timeDraft?.iso ?? null;
    const groups = groupByTimestamp(events);
    for (const grp of groups) {
      const pushed = draftIso !== null && draftIso === grp.atIso;
      const selected = pushed || (draftIso === null ? grp.steps.some((e) => e.selected) : false);
      const row = el("div", `calclens-tl-row${selected ? " selected" : ""}`);
      const gutter = el("div", "calclens-tl-gutter");
      gutter.appendChild(icon("clock" as any, "calclens-tl-icn"));
      if (pickable) gutter.appendChild(icon("check-circle-2" as any, "calclens-tl-pick-icn"));
      row.appendChild(gutter);
      const body = el("div", "calclens-tl-body");
      body.appendChild(el("span", "calclens-tl-time", grp.atLabel || grp.atIso || "\u00b7"));
      const changes = el("div", "calclens-tl-changes");
      for (const ev of grp.steps) changes.appendChild(this.renderChange(ev));
      body.appendChild(changes);
      row.appendChild(body);
      if (pickable) {
        row.classList.add("pickable");
        row.addEventListener("click", () => {
          const first = grp.steps[0];
          pickable(first);
          this.paintTimeline(events, pickable);
        });
      }
      this.timeListEl.appendChild(row);
    }
  }

  /** One change line inside a grouped timestamp: field icon + label: from → to. */
  private renderChange(ev: TimelineStep): HTMLElement {
    const wrap = el("div", "calclens-tl-change");
    const icnName: string = ev.fieldIcon === "group" ? "building-2" : ev.fieldIcon === "assignee" ? "user" : "flag";
    wrap.appendChild(icon(icnName as any, "calclens-tl-change-icn"));
    wrap.appendChild(this.renderDesc(ev));
    return wrap;
  }

  /** Field label + spaced arrow + brighter values on one line. */
  private renderDesc(ev: TimelineStep): HTMLElement {
    const wrap = el("span", "calclens-tl-desc");
    const label = ev.fieldIcon === "group" ? "Assignment group" : ev.fieldIcon === "assignee" ? "Assigned to" : "Status";
    wrap.appendChild(el("span", "calclens-tl-desc-label", label + ":"));
    wrap.appendChild(el("span", "calclens-tl-desc-value", ev.from || "empty"));
    wrap.appendChild(el("span", "calclens-tl-arrow", "\u2192"));
    wrap.appendChild(el("span", "calclens-tl-desc-value", ev.to || "empty"));
    return wrap;
  }

  private renderTimeline(events: TimelineStep[], pickable?: (ev: TimelineStep) => void): HTMLElement {
    const wrap = el("div", "calclens-section calclens-timeline");
    wrap.appendChild(el("div", "calclens-section-title", "Timeline"));
    const list = el("div", "calclens-tl");
    this.timeListEl = list;
    this.tlEvents = events;
    this.tlPickable = pickable;
    this.paintTimeline(events, pickable);
    wrap.appendChild(list);
    return wrap;
  }

  /** Performs a re-render of only the edit control's host body (drawer stays open). */
  private repatch(): void {
    const next = this.getState();
    const body = this.q<HTMLElement>(".calclens-body");
    if (body) this.renderBody(body, next.explanation, next.edit);
  }

  private renderDigest(d: SlDigest): HTMLElement {
    const wrap = el("div", "calclens-section calclens-digest");
    wrap.appendChild(el("div", "calclens-section-title", "SLA digest"));

    const targetRow = el("div", "digest-row");
    targetRow.appendChild(icon("target" as any, "digest-icn"));
    targetRow.appendChild(el("span", "digest-label", d.targetLabel));
    targetRow.appendChild(el("span", "digest-value", d.target));
    wrap.appendChild(targetRow);

    const actualRow = el("div", "digest-row");
    actualRow.appendChild(icon("clock" as any, "digest-icn"));
    actualRow.appendChild(el("span", "digest-label", "Actual"));
    actualRow.appendChild(el("span", "digest-value", d.actual));
    wrap.appendChild(actualRow);

    if (d.sourceTimes && d.sourceTimes.length) {
      const src = el("div", "calclens-section digest-src");
      src.appendChild(el("div", "calclens-section-title", "Source times"));
      for (const s of d.sourceTimes) {
        const row = el("div", "digest-row");
        row.appendChild(icon("clock" as any, "digest-icn"));
        row.appendChild(el("span", "digest-label", s.label));
        row.appendChild(el("span", "digest-value", s.value || "\u2014"));
        src.appendChild(row);
      }
      if (d.op) {
        src.appendChild(el("div", "digest-op", d.op));
      }
      wrap.appendChild(src);
    }

    const verdictCls = d.met === null ? "unknown" : d.met ? "met" : "breach";
    const verdict = el("div", `digest-verdict ${verdictCls}`);
    verdict.appendChild(icon(d.met ? "check-circle-2" : "x-circle", "digest-verdict-icn"));
    verdict.appendChild(document.createTextNode(" " + d.metLabel));
    wrap.appendChild(verdict);

    if (d.line) {
      wrap.appendChild(el("p", "digest-line", d.line));
    }
    return wrap;
  }

  show(explanation: Explanation | null, edit: CalclensEdit | null = null): void {
    // Moving to another cell discards any unsaved time draft.
    this.timeDraft = null;
    this.timeInput = null;
    this.timeListEl = null;
    this.setState({ open: true, explanation, edit });
  }

  close(): void {
    if (!this.getState().open) return;
    this.timeDraft = null;
    this.timeInput = null;
    this.timeListEl = null;
    this.setState({ open: false, explanation: null, edit: null });
    this.deps.onClosed?.();
  }

  isOpen(): boolean {
    return this.getState().open;
  }
}

function field(label: string, value: string): HTMLElement {
  const wrap = el("div", "calclens-field");
  wrap.appendChild(el("span", "calclens-field-label", label));
  wrap.appendChild(el("span", "calclens-field-value", value || "\u2014"));
  return wrap;
}

function fieldBlock(label: string, value: string): HTMLElement {
  const wrap = el("div", "calclens-section");
  wrap.appendChild(el("div", "calclens-section-title", label));
  wrap.appendChild(el("p", "", value));
  return wrap;
}

function kindIconName(kind: string): string {
  switch (kind) {
    case "timeline": return "alarm-clock";
    case "duration": return "timer";
    case "report": return "chart-line";
    case "classification": return "tag";
    default: return "file-text";
  }
}

/** Groups a flat, chronological list of timeline events by their timestamp. */
function groupByTimestamp(events: TimelineStep[]): Array<{ atIso: string; atLabel: string; steps: TimelineStep[] }> {
  const out: Array<{ atIso: string; atLabel: string; steps: TimelineStep[] }> = [];
  for (const ev of events) {
    const last = out[out.length - 1];
    if (last && last.atIso === ev.atIso) {
      last.steps.push(ev);
    } else {
      out.push({ atIso: ev.atIso, atLabel: ev.atLabel, steps: [ev] });
    }
  }
  return out;
}

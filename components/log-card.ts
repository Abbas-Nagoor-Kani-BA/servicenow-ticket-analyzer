import { Component, el } from "./component.ts";
import type { ComponentProps } from "./component.ts";

export type LogLevel = "" | "error" | "success";

export type LogEntry = {
  time: string;
  text: string;
  level: LogLevel;
};

export type LogCardDeps = {
  /** The centred popup, which lives outside the inline log card. */
  modal: HTMLElement;
};

export type LogCardState = {
  entries: LogEntry[];
  errorCount: number;
  modalOpen: boolean;
};

export type LogCardRefs = {
  card: HTMLElement;
  head: HTMLElement;
  list: HTMLElement;
  errBadge: HTMLElement;
  modal: HTMLElement;
  mirror: HTMLElement;
  closeBtn: HTMLElement;
  copyBtn: HTMLElement;
};

const LEVEL_COLOUR: Record<LogLevel, string> = {
  "": "",
  error: "#f38ba8",
  success: "#a6e3a1"
};

/**
 * The panel's log: an inline list plus a centred popup showing the same entries.
 *
 * Owns its entries rather than appending to the DOM and reading it back, so
 * opening the popup can rebuild from state instead of copying nodes.
 */
export class LogCard extends Component<LogCardState, ComponentProps, LogCardDeps> {
  protected declare refs: LogCardRefs;

  #onKeyDown: (e: KeyboardEvent) => void;

  constructor(root: HTMLElement, deps: LogCardDeps, props: ComponentProps = {}) {
    super(root, props, deps);
    this.#onKeyDown = (e) => {
      if (e.key === "Escape" && this.getState().modalOpen) this.close();
    };
    document.addEventListener("keydown", this.#onKeyDown);
  }

  protected initialState(): LogCardState {
    return { entries: [], errorCount: 0, modalOpen: false };
  }

  protected build(): void {
    this.refs.card = this.root;
    this.refs.head = this.q("#logHead");
    this.refs.list = this.q("#log");
    this.refs.errBadge = this.q("#logErrBadge");
    const modal = this.deps.modal;
    this.refs.modal = modal;
    this.refs.mirror = require(modal.querySelector("#logMirror"), "#logMirror");
    this.refs.closeBtn = require(modal.querySelector("#logClose"), "#logClose");
    this.refs.copyBtn = require(modal.querySelector("#logCopy"), "#logCopy");

    this.refs.head.addEventListener("click", () => this.open());
    this.refs.closeBtn.addEventListener("click", () => this.close());
    this.refs.modal.addEventListener("click", (e) => {
      if (e.target === this.refs.modal) this.close();
    });
    this.refs.copyBtn.addEventListener("click", () => this.copyAll());
  }

  protected patch(next: LogCardState, prev: LogCardState | null): void {
    if (!prev || next.entries !== prev.entries) {
      this.syncEntries(next, prev);
    }
    if (!prev || next.errorCount !== prev.errorCount) {
      this.refs.errBadge.textContent = String(next.errorCount);
      this.refs.errBadge.classList.toggle("hidden", next.errorCount === 0);
    }
    if (!prev || next.modalOpen !== prev.modalOpen) {
      this.refs.modal.classList.toggle("hidden", !next.modalOpen);
      if (next.modalOpen) this.renderMirror(next);
    }
    this.refs.card.classList.toggle("hidden", next.entries.length === 0);
  }

  protected syncEntries(next: LogCardState, prev: LogCardState | null): void {
    const from = prev ? prev.entries.length : 0;
    for (let i = from; i < next.entries.length; i++) {
      this.refs.list.appendChild(renderLine(next.entries[i]));
    }
    this.refs.list.scrollTop = this.refs.list.scrollHeight;

    if (next.modalOpen && prev) {
      for (let i = from; i < next.entries.length; i++) {
        this.refs.mirror.appendChild(renderLine(next.entries[i]));
      }
      this.refs.mirror.scrollTop = this.refs.mirror.scrollHeight;
    }
  }

  protected renderMirror(state: LogCardState): void {
    this.refs.mirror.innerHTML = "";
    for (const entry of state.entries) this.refs.mirror.appendChild(renderLine(entry));
    this.refs.mirror.scrollTop = this.refs.mirror.scrollHeight;
  }

  protected copyAll(): void {
    const text = this.getState()
      .entries.map((e) => `[${e.time}] ${e.text}`)
      .join("\n");
    navigator.clipboard
      .writeText(text)
      .then(() => {
        this.refs.copyBtn.textContent = "Copied";
        setTimeout(() => {
          this.refs.copyBtn.textContent = "Copy all";
        }, 1500);
      })
      .catch(() => {
        /* clipboard denied — the log stays visible either way */
      });
  }

  log(text: string, level: LogLevel = ""): void {
    const entry: LogEntry = { time: new Date().toLocaleTimeString(), text, level };
    this.setState((state) => ({
      entries: [...state.entries, entry],
      errorCount: state.errorCount + (level === "error" ? 1 : 0)
    }));
  }

  open(): void {
    this.setState({ modalOpen: true });
  }

  close(): void {
    this.setState({ modalOpen: false });
  }

  protected override onDestroy(): void {
    document.removeEventListener("keydown", this.#onKeyDown);
  }
}

function require<T extends HTMLElement>(node: T | null, selector: string): T {
  if (!node) throw new Error(`LogCard: missing required element "${selector}"`);
  return node;
}

function renderLine(entry: LogEntry): HTMLElement {
  const line = el("div", entry.level || undefined, `[${entry.time}] ${entry.text}`);
  const colour = LEVEL_COLOUR[entry.level];
  if (colour) line.style.color = colour;
  return line;
}

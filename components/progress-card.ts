import { Component } from "./component.ts";
import type { ComponentProps } from "./component.ts";

export type ProgressTone = "pending" | "busy" | "good" | "bad";

export type ProgressCardState = {
  visible: boolean;
  percent: number;
  tone: ProgressTone;
  stage: string;
  label: string;
  pulled: number | null;
  planned: number | null;
};

export type ProgressCardRefs = {
  wrap: HTMLElement;
  fill: HTMLElement;
  label: HTMLElement;
  counter: HTMLElement;
};

const TONE_COLOUR: Record<ProgressTone, string> = {
  pending: "#fab387",
  busy: "#fab387",
  good: "var(--good)",
  bad: "var(--bad)"
};

const STAGE_PCT: Record<string, number | null> = {
  resolve: 8,
  count: 15,
  phase1: null,
  phase2: null,
  analyze: 92
};

const STAGE_BASE: Record<string, number> = { phase1: 20, phase2: 60 };

const fmtNum = (n: number): string => Number(n || 0).toLocaleString("en-US");

/**
 * Run progress: bar, stage label and pulled/planned counter.
 *
 * The percentage is derived from stage plus counts rather than stored, so a
 * caller only reports what happened — it never has to compute a width.
 */
export class ProgressCard extends Component<ProgressCardState, ComponentProps> {
  protected declare refs: ProgressCardRefs;

  constructor(root: HTMLElement, props: ComponentProps = {}) {
    super(root, props, {});
  }

  protected initialState(): ProgressCardState {
    return {
      visible: false,
      percent: 4,
      tone: "pending",
      stage: "",
      label: "",
      pulled: null,
      planned: null
    };
  }

  protected build(): void {
    this.refs.wrap = this.root;
    this.refs.fill = this.q("#fill");
    this.refs.label = this.q("#stageLabel");
    this.refs.counter = this.q("#pullCounter");
  }

  protected patch(next: ProgressCardState, prev: ProgressCardState | null): void {
    this.refs.wrap.classList.toggle("hidden", !next.visible);

    if (!prev || next.percent !== prev.percent) {
      this.refs.fill.style.width = `${next.percent}%`;
    }
    if (!prev || next.tone !== prev.tone) {
      this.refs.fill.style.background = TONE_COLOUR[next.tone];
    }
    if (!prev || next.label !== prev.label) {
      this.refs.label.textContent = next.label;
    }
    this.patchCounter(next);
  }

  protected patchCounter(state: ProgressCardState): void {
    const { pulled, planned } = state;
    const show =
      typeof pulled === "number" && typeof planned === "number" && planned > 0 && state.visible;
    this.refs.counter.classList.toggle("hidden", !show);
    if (!show) return;
    this.refs.counter.textContent =
      `${fmtNum(pulled as number)} of ${fmtNum(planned as number)} pulled \xB7 ` +
      `${fmtNum(Math.max(0, (planned as number) - (pulled as number)))} remaining`;
  }

  /** Shows the card in its starting state. */
  begin(label = "Starting\u2026"): void {
    this.setState({ visible: true, percent: 4, tone: "pending", stage: "", label, pulled: null, planned: null });
  }

  /** Hides the card again. */
  end(): void {
    this.setState({ visible: false });
  }

  /** Replaces the stage text without touching the bar. */
  setLabel(label: string): void {
    this.setState({ label });
  }

  /**
   * Applies one progress message from the background.
   *
   * @returns the level the entry should be logged at, or `null` to skip it
   */
  apply(msg: { stage: string; detail?: unknown; pulled?: unknown; planned?: unknown }): LogLevel {
    const detail = String(msg.detail ?? "");
    const pulled = typeof msg.pulled === "number" ? msg.pulled : null;
    const planned = typeof msg.planned === "number" ? msg.planned : null;

    if (msg.stage === "diag") {
      // Diagnostics describe requests, not run progress — the bar must not move.
      return /401|403|429|MISSING|RATE LIMITED/.test(detail) ? "error" : "info";
    }

    if (msg.stage === "limit" || msg.stage === "error") {
      this.setState({ percent: 100, tone: "bad", stage: msg.stage, label: detail });
      return "error";
    }

    if (msg.stage === "done") {
      this.setState({ percent: 100, tone: "good", stage: "done", label: detail, pulled: null, planned: null });
      return "success";
    }

    this.setState({
      tone: "busy",
      stage: msg.stage,
      label: detail,
      pulled,
      planned,
      percent: this.percentFor(msg.stage, detail, pulled, planned)
    });
    return "info";
  }

  protected percentFor(stage: string, detail: string, pulled: number | null, planned: number | null): number {
    if (stage === "phase1" && pulled !== null && planned) {
      return STAGE_BASE.phase1 + Math.min(1, pulled / planned) * 40;
    }
    const fixed = STAGE_PCT[stage];
    if (fixed === null || fixed === undefined) {
      const match = detail.match(/(\d+)\/(\d+)/);
      const base = STAGE_BASE[stage] ?? 0;
      if (!match) return base;
      const span = stage === "phase1" ? 40 : 25;
      return Math.min(base + (Number(match[1]) / Number(match[2])) * span, base + 24);
    }
    return fixed;
  }
}

export type LogLevel = "info" | "error" | "success";

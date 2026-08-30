import { Component } from "./component.ts";
import type { ComponentProps } from "./component.ts";

export type ModalState = {
  open: boolean;
};

export type ModalDeps = {
  /** Runs after the modal closes by any route — Escape, backdrop, or close(). */
  onClosed?: () => void;
  /** Close when the backdrop itself is clicked. Defaults to true. */
  backdropClose?: boolean;
  /** Return true to swallow Escape for now, e.g. while a cell editor is open. */
  escapeGuard?: () => boolean;
};

/**
 * Currently-open modals, innermost last.
 *
 * The viewer closes modals in a strict order — the column picker before the
 * mapping dialog before the config dialog — which was previously a hand-written
 * if-chain in one document keydown handler. A stack expresses that directly and
 * stops growing an if-branch every time a dialog is added.
 */
const openStack: Modal[] = [];

/** True while any modal is open. Lets other Escape handlers stand down. */
export function hasOpenModal(): boolean {
  return openStack.length > 0;
}

/** Closes every open modal, innermost last. Makes state resets predictable. */
export function closeAllModals(): void {
  for (const modal of [...openStack].reverse()) modal.close();
}

let escapeInstalled = false;

function installEscape(): void {
  if (escapeInstalled) return;
  escapeInstalled = true;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    for (let i = openStack.length - 1; i >= 0; i--) {
      const modal = openStack[i];
      if (!modal) continue;
      if (modal.allowsEscape()) {
        e.preventDefault();
        modal.close();
        return;
      }
      // A guard that is holding means everything below it must stay open too.
      return;
    }
  });
}

/**
 * A hidden-by-default overlay.
 *
 * Root is the element carrying the `hidden` class. Subclasses build their own
 * contents into it.
 */
export class Modal extends Component<ModalState, ComponentProps, ModalDeps> {
  protected initialState(): ModalState {
    return { open: false };
  }

  protected build(): void {
    installEscape();
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root && (this.deps.backdropClose ?? true)) this.close();
    });
  }

  protected patch(next: ModalState, prev: ModalState | null): void {
    this.root.classList.toggle("hidden", !next.open);

    const wasOpen = prev?.open ?? false;
    if (next.open && !wasOpen) openStack.push(this);
    if (!next.open && wasOpen) {
      const at = openStack.indexOf(this);
      if (at >= 0) openStack.splice(at, 1);
    }
  }

  open(): void {
    this.setState({ open: true });
  }

  close(): void {
    if (!this.getState().open) return;
    this.setState({ open: false });
    this.deps.onClosed?.();
  }

  isOpen(): boolean {
    return this.getState().open;
  }

  /** True when Escape should close this modal right now. */
  allowsEscape(): boolean {
    return !this.deps.escapeGuard?.();
  }
}

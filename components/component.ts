export type Handler = (detail?: any) => void;

export type ComponentProps = {
  on?: Record<string, Handler | undefined>;
};

/**
 * Base class for every UI component.
 *
 * Lifecycle is deliberately **build once, patch always**:
 *
 * - `build()` runs exactly once from the constructor. It locates or creates the
 *   component's elements and wires its listeners.
 * - `patch(next, prev)` runs on every state change and touches only what
 *   actually differs.
 *
 * Rebuilding a subtree per state change destroys input focus and caret
 * position, and is far too expensive for large lists. Making the split
 * explicit means focus loss is impossible by construction rather than
 * something every caller has to remember.
 *
 * **Subclasses must not use instance fields or `#private` methods from
 * `build()` or the first `patch()`.** Both are installed on the instance only
 * *after* `super()` returns, but the base constructor calls `build()` — so a
 * subclass field reads as `undefined` and a `#private` method call throws
 * `TypeError: Receiver must be an instance of class ...`. This was hit twice
 * during the panel migration.
 *
 * Therefore:
 * - helpers called from `build()`/`patch()` must be `protected` **methods**
 *   (on the prototype, so available immediately) — not `#private` ones
 * - `#private` fields and methods are fine for anything touched only *after*
 *   construction, such as teardown handlers
 * - everything a component needs arrives through `props` (passed in) or `deps`
 *   (injected); anything it creates belongs in `refs`
 */
export abstract class Component<
  S extends object,
  P extends ComponentProps = ComponentProps,
  D = Record<string, unknown>
> {
  protected readonly root: HTMLElement;
  protected readonly props: P;
  protected readonly deps: D;
  protected readonly refs: Record<string, HTMLElement> = {};

  #state: S;
  #destroyed = false;

  constructor(root: HTMLElement, props: P, deps: D) {
    this.root = root;
    this.props = props;
    this.deps = deps;
    this.#state = this.initialState();
    this.build();
    this.patch(this.#state, null);
  }

  /** Creates the component's DOM and wires its listeners. Runs once. */
  protected abstract build(): void;

  /** Applies a state change to the existing DOM. */
  protected abstract patch(next: S, prev: S | null): void;

  protected abstract initialState(): S;

  protected getState(): S {
    return this.#state;
  }

  protected setState(patch: Partial<S> | ((state: S) => Partial<S>)): void {
    if (this.#destroyed) return;
    const prev = this.#state;
    this.#state = { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) };
    this.patch(this.#state, prev);
  }

  protected emit(name: string, detail?: unknown): void {
    this.props.on?.[name]?.(detail);
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.onDestroy();
  }

  protected onDestroy(): void {
    /* subclasses override to release document-level listeners */
  }

  /** Narrow helper for element lookups inside this component's root. */
  protected q<T extends HTMLElement = HTMLElement>(selector: string): T {
    const found = this.root.querySelector<T>(selector);
    if (!found) throw new Error(`Component: missing required element "${selector}"`);
    return found;
  }
}

/** Small DOM helper shared by components. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

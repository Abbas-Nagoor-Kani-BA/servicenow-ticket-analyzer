import type { Token } from "./token.ts";

/** Factory that receives the container resolution started from. */
export type Provider<T> = (c: Container) => T;

/** A class exposing its constructor dependencies as a static `deps` array. */
export type ClassWithDeps<T> = (new (...args: any[]) => T) & {
  readonly deps: readonly Token<any>[];
};

export type RegisterOptions = { singleton?: boolean };

/**
 * Minimal constructor-injection container.
 *
 * Deliberately reflection-free: esbuild does not implement
 * `emitDecoratorMetadata`, so decorator/reflection DI is unavailable. Classes
 * declare their dependencies as a static `deps` array of tokens instead,
 * which keeps full type inference and needs no transform step.
 *
 * Resolving walks up to the parent container, so `child()` gives a surface or
 * test an override scope without mutating the root.
 */
export class Container {
  #providers = new Map<string, Provider<unknown>>();
  #singletons = new Map<string, unknown>();
  #parent: Container | null;

  constructor(parent: Container | null = null) {
    this.#parent = parent;
  }

  /** Registers an already-constructed value. Always a singleton. */
  registerValue<T>(t: Token<T>, value: T): this {
    this.#providers.set(t, () => value);
    this.#singletons.set(t, value);
    return this;
  }

  /**
   * Registers a factory. `singleton: true` memoises one instance **per
   * container**, not globally: a child resolving an inherited singleton builds
   * and caches its own, using the child's own overrides.
   *
   * Root-owned singletons would hand a child the parent's already-built
   * instance, silently ignoring any override the child registered — which is
   * exactly the fake-repository swap the container exists to enable.
   */
  register<T>(t: Token<T>, factory: Provider<T>, opts: RegisterOptions = {}): this {
    if (!opts.singleton) {
      this.#providers.set(t, factory as Provider<unknown>);
      return this;
    }
    this.#providers.set(t, (root) => {
      if (!root.#singletons.has(t)) root.#singletons.set(t, factory(root));
      return root.#singletons.get(t) as T;
    });
    return this;
  }

  /**
   * Registers a class, auto-wiring its `static deps` tokens.
   *
   * @param Ctor class whose `static deps` lists its constructor tokens in order
   */
  registerClass<T>(t: Token<T>, Ctor: ClassWithDeps<T>, opts: RegisterOptions = {}): this {
    return this.register(t, (c) => new Ctor(...Ctor.deps.map((d) => c.resolve(d))), opts);
  }

  /**
   * Resolves a token, falling back to the parent container.
   *
   * @throws if nothing is registered for the token in this container or any ancestor
   */
  resolve<T>(t: Token<T>): T {
    return this.#resolveFrom(t, this);
  }

  /**
   * Walks up to whichever ancestor owns `t`, then invokes its provider with
   * `root` — the container resolution started from — so that a child's
   * overrides apply even to services registered in a parent. Passing `this`
   * instead would silently ignore every child override.
   */
  #resolveFrom<T>(t: Token<T>, root: Container): T {
    const local = this.#providers.get(t);
    if (local) return local(root) as T;
    if (this.#parent) return this.#parent.#resolveFrom(t, root);
    throw new Error(`DI: nothing registered for "${t}"`);
  }

  /** True when the token is registered here or in an ancestor. */
  has(t: Token<unknown>): boolean {
    return this.#providers.has(t) || (this.#parent?.has(t) ?? false);
  }

  /** Returns a child container that inherits these registrations. */
  child(): Container {
    return new Container(this);
  }
}

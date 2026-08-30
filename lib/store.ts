export type StoreState<S> = S;
export type Patch<S> = Partial<S> | ((prev: S) => Partial<S>);
export type Subscription = () => void;

export function createStore<S extends object>(initial: S): {
  getState: () => S;
  setState: (patch: Patch<S>) => void;
  subscribe: (listener: (state: S) => void) => Subscription;
  use: <T>(selector: (state: S) => T) => T;
} {
  let state: S = { ...initial };
  const listeners = new Map<number, { listener: (state: S) => void }>();
  let nextId = 1;

  function getState(): S {
    return state;
  }

  function setState(patch: Patch<S>): void {
    if (typeof patch === "function") {
      state = { ...state, ...patch(state) };
    } else if (patch) {
      state = { ...state, ...patch };
    }
    for (const entry of listeners.values()) {
      entry.listener(state);
    }
  }

  function subscribe(listener: (state: S) => void): Subscription {
    const id = nextId++;
    listeners.set(id, { listener });
    return () => listeners.delete(id);
  }

  function use<T>(selector: (state: S) => T): T {
    return selector(state);
  }

  return { getState, setState, subscribe, use };
}
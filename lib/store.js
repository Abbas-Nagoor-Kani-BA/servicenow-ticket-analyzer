export function createStore(initial) {
  let state = { ...initial };
  const listeners = new Map();
  let nextId = 1;

  function getState() {
    return state;
  }

  function setState(patch) {
    if (typeof patch === "function") {
      state = { ...state, ...patch(state) };
    } else if (patch) {
      state = { ...state, ...patch };
    }
    for (const entry of listeners.values()) {
      entry.listener(state);
    }
  }

  function subscribe(listener) {
    const id = nextId++;
    listeners.set(id, { listener });
    return () => listeners.delete(id);
  }

  function use(selector) {
    return selector(state);
  }

  return { getState, setState, subscribe, use };
}

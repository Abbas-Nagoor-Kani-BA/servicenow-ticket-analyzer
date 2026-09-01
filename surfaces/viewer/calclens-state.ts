/**
 * Calclens mode owner.
 *
 * A plain boolean held here (single owner). Calclens is a session toggle: it
 * always starts OFF on page load and is never persisted, so the state resets
 * automatically. The viewer's grid, interactions and the Calclens panel read
 * and write through these accessors so no other module owns the flag.
 */
let calclensMode = false;

const getCalclensMode = (): boolean => calclensMode;

function setCalclensMode(v: boolean): void {
  calclensMode = !!v;
}

export { getCalclensMode, setCalclensMode };

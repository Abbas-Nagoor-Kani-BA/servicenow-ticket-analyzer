/**
 * Action rail — draggable + foldable behaviour for the floating icon rail.
 *
 * The rail (#actionRail) floats over the data view. The user can drag it by its
 * grip handle (#railGrip) and fold it to just the grip+fold header (#railFold);
 * folded, it stays draggable. Position (x/y) and folded state persist across
 * reloads via chrome.storage.local, mirroring the other viewer prefs. A stored
 * off-screen position is re-clamped into view on load.
 *
 * No component framework here: the rail is plain toolbar markup wired by id, so
 * this module just attaches pointer/click handlers and applies inline position.
 */
import { STORAGE } from "../../lib/keys.ts";
import { loadOnce, saveValue } from "../../lib/storage.ts";
import { iconize } from "../../lib/icons.ts";

const $ = (id: string): HTMLElement | null => document.getElementById(id);

type RailPrefs = { x: number | null; y: number | null; folded: boolean };

let prefs: RailPrefs = { x: null, y: null, folded: false };

/** Clamp a top-left position so the WxH box stays fully within viewW x viewH,
 *  never above `minTop` (leaves room for the toolbar). Pure, unit-tested. */
export function clampPosition(
  x: number, y: number, w: number, h: number,
  viewW: number, viewH: number, minTop = 0
): { x: number; y: number } {
  const maxX = Math.max(0, viewW - w);
  const maxY = Math.max(minTop, viewH - h);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(minTop, y), maxY)
  };
}

function viewport(): { w: number; h: number } {
  return { w: window.innerWidth || 1024, h: window.innerHeight || 768 };
}

const MIN_TOP = 48; // keep the rail below the toolbar

function persist(): void {
  void saveValue(STORAGE.viewerActionRail, { ...prefs });
}

/** Apply the current position as inline left/top (overriding the CSS right/top). */
function applyPosition(rail: HTMLElement): void {
  if (prefs.x === null || prefs.y === null) return;
  const rect = rail.getBoundingClientRect();
  const { w, h } = viewport();
  const c = clampPosition(prefs.x, prefs.y, rect.width || 40, rect.height || 40, w, h, MIN_TOP);
  prefs.x = c.x;
  prefs.y = c.y;
  rail.style.left = `${c.x}px`;
  rail.style.top = `${c.y}px`;
  rail.style.right = "auto";
}

function applyFold(rail: HTMLElement): void {
  rail.classList.toggle("folded", prefs.folded);
  const fold = $("railFold");
  if (fold) {
    iconize(fold as HTMLButtonElement, prefs.folded ? "chevron-down" : "chevron-up", {
      mode: "icon",
      tip: prefs.folded ? "Expand" : "Collapse"
    });
  }
}

/** Load persisted rail prefs (position + folded). */
export async function loadRailPrefs(): Promise<void> {
  const stored = await loadOnce<Partial<RailPrefs>>(STORAGE.viewerActionRail, {});
  prefs = {
    x: typeof stored?.x === "number" ? stored.x : null,
    y: typeof stored?.y === "number" ? stored.y : null,
    folded: stored?.folded === true
  };
}

function wireDrag(rail: HTMLElement, grip: HTMLElement): void {
  let dragging = false;
  let startX = 0, startY = 0, baseX = 0, baseY = 0;

  grip.addEventListener("pointerdown", (e) => {
    const pe = e as PointerEvent;
    pe.preventDefault();
    const rect = rail.getBoundingClientRect();
    dragging = true;
    startX = pe.clientX;
    startY = pe.clientY;
    baseX = rect.left;
    baseY = rect.top;
    grip.classList.add("dragging");
    try { grip.setPointerCapture(pe.pointerId); } catch { /* best-effort */ }
  });

  grip.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const pe = e as PointerEvent;
    const rect = rail.getBoundingClientRect();
    const { w, h } = viewport();
    const c = clampPosition(
      baseX + (pe.clientX - startX),
      baseY + (pe.clientY - startY),
      rect.width || 40, rect.height || 40, w, h, MIN_TOP
    );
    prefs.x = c.x;
    prefs.y = c.y;
    rail.style.left = `${c.x}px`;
    rail.style.top = `${c.y}px`;
    rail.style.right = "auto";
  });

  const end = (e: Event) => {
    if (!dragging) return;
    dragging = false;
    grip.classList.remove("dragging");
    try { grip.releasePointerCapture((e as PointerEvent).pointerId); } catch { /* best-effort */ }
    persist();
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
}

/** Wire the rail's drag + fold behaviour. Called once at boot. */
export function initActionRail(): void {
  const rail = $("actionRail");
  const grip = $("railGrip");
  const fold = $("railFold");
  if (!rail || !grip || !fold) return;

  iconize(grip as HTMLButtonElement, "grip-vertical", { mode: "icon", tip: "Drag to move" });

  loadRailPrefs().then(() => {
    applyFold(rail);
    applyPosition(rail);
  }).catch(() => { applyFold(rail); });

  // Reflect any synchronous default immediately (icon on the fold button).
  applyFold(rail);

  fold.addEventListener("click", () => {
    prefs.folded = !prefs.folded;
    applyFold(rail);
    persist();
  });

  wireDrag(rail, grip);

  // Re-clamp on window resize so the rail never ends up off-screen.
  window.addEventListener("resize", () => applyPosition(rail));
}

/** Test hook: current prefs snapshot. */
export function getRailPrefs(): RailPrefs {
  return { ...prefs };
}

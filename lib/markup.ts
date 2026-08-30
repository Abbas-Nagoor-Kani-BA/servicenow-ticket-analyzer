function xmlEscape(s: unknown): string {
  const map: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  };
  return String(s).replace(/[&<>"']/g, ch => map[ch]);
}
function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
function encodeText(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}
function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
function letterToColNum(s: string): number {
  let n = 0;
  for (const ch of String(s).trim().toUpperCase()) {
    const v = ch.charCodeAt(0) - 64;
    if (v < 1 || v > 26) return 0;
    n = n * 26 + v;
  }
  return n;
}

/**
 * Position a floating popup under `rect`, clamping it to the viewport.
 *
 * Moved here from surfaces/viewer/core.js so components do not have to import
 * from a surface.
 */
export type RectLike = { left: number; top: number; bottom: number; width: number };

/** Max characters shown in a grid cell before truncating; full text goes in the tooltip. */
export const CELL_MAX = 60;
function cellShort(text: string): string {
  return text.length > CELL_MAX ? text.slice(0, CELL_MAX).trimEnd() + "\u2026" : text;
}

function placePopupNear(pop: HTMLElement, rect: RectLike, minW: number, gap = 4): void {
  const w = Math.max(rect.width, minW);
  pop.style.width = `${w}px`;
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
  let top = rect.bottom + gap;
  if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - pop.offsetHeight - gap);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

export {
  xmlEscape,
  decodeText,
  encodeText,
  colLetter,
  letterToColNum,
  placePopupNear,
  cellShort
};
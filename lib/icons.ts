/**
 * Lucide icon helpers — a small reusable icon library.
 *
 * Vendored from `lucide-static` (ISC-licensed); the SVG path data lives in
 * `lib/icons-data.ts`, generated from `lib/vendor/lucide/*.svg` (run
 * `node tools/gen-icons-data.mjs` to regenerate). Keeping the paths as string
 * constants here means icons work identically in the browser bundle and in
 * offline Node tests, without a filesystem read or network fetch.
 *
 * Two entry points:
 *   - `icon(name, cls?)`      — a standalone inline `<svg>` element (drawer glyphs etc.)
 *   - `iconButton(name, tip)` — an icon-only `<button class="btn icon-btn">`
 *                               with a tooltip, ready for toolbar / modal / row use.
 * The iconButton is the primitive the button→icon migration ("near feature")
 * will reuse across the viewer, panel, settings and components.
 */

import { ICON_DATA } from "./icons-data.ts";

export type IconName = keyof typeof ICON_DATA;

const SVG_NS = "http://www.w3.org/2000/svg";

function iconMarkup(name: string): string {
  const inner = ICON_DATA[name];
  if (!inner) return "";
  return (
    `<svg xmlns="${SVG_NS}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    inner +
    `</svg>`
  );
}

/** Inline `<svg>` as an HTML string. */
export function iconHTML(name: IconName, cls?: string): string {
  const svg = iconMarkup(name);
  if (!svg) return "";
  return cls ? svg.replace("<svg ", `<svg class="${cls}" `) : svg;
}

/** Standalone inline `<svg>` element (for drawer glyphs and other inline use). */
export function icon(name: IconName, cls?: string): SVGSVGElement {
  const svg = iconMarkup(name);
  const host = document.createElement("div");
  host.innerHTML = svg || "";
  const el = host.firstElementChild as SVGSVGElement | null;
  if (!el) return document.createElementNS(SVG_NS, "svg") as unknown as SVGSVGElement;
  if (cls) el.setAttribute("class", cls);
  el.setAttribute("data-icon", name);
  return el;
}

export type IconButtonOpts = {
  cls?: string;
  size?: number;
  label?: string;
};

/**
 * Icon-only button for toolbars / modals / rows. Sets `data-tip` so the
 * existing tooltip system (`lib/tooltip.ts` → `initTooltips`) drives its
 * hover label, and `aria-label` for accessibility.
 */
export function iconButton(name: IconName, tip: string, opts: IconButtonOpts = {}): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `btn icon-btn${opts.cls ? " " + opts.cls : ""}`;
  btn.setAttribute("data-tip", tip);
  btn.setAttribute("aria-label", opts.label ?? tip);
  const svg = icon(name);
  if (opts.size) {
    svg.setAttribute("width", String(opts.size));
    svg.setAttribute("height", String(opts.size));
  }
  svg.setAttribute("class", "icon-btn-svg");
  btn.appendChild(svg);
  return btn;
}

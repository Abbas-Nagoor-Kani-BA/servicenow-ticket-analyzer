let tip: HTMLDivElement | null = null;
let currentEl: HTMLElement | null = null;
let initialized = false;

const OFFSET = 10;
const MARGIN = 10;
const SHOW_DELAY = 500;

let delayTimer: ReturnType<typeof setTimeout> | null = null;
let lastX = 0;
let lastY = 0;
let suppressed: (() => boolean) | null = null;

function ensureTip(): HTMLDivElement {
  if (tip) return tip;
  tip = document.createElement("div");
  tip.className = "tip";
  document.body.appendChild(tip);
  return tip;
}

function tipTextFor(el: HTMLElement): string {
  const t = el.getAttribute("data-tip");
  if (t != null && t !== "") return t;
  return "";
}

function placeTip(el: HTMLElement): void {
  const root = ensureTip();
  const text = tipTextFor(el);
  if (!text) return;
  root.textContent = text;
  root.classList.remove("warn");
  if (el.classList.contains("tip-warn")) root.classList.add("warn");
  root.classList.add("in");
  positionTip(lastX, lastY);
}

function positionTip(x: number, y: number): void {
  if (!tip) return;
  const rect = tip.getBoundingClientRect();
  let nx = x + OFFSET;
  let ny = y + OFFSET;
  if (nx + rect.width + MARGIN > window.innerWidth) {
    nx = x - rect.width - OFFSET;
  }
  if (nx < MARGIN) nx = MARGIN;
  if (ny + rect.height + MARGIN > window.innerHeight) {
    ny = y - rect.height - OFFSET;
  }
  if (ny < MARGIN) ny = MARGIN;
  tip.style.left = `${nx}px`;
  tip.style.top = `${ny}px`;
}

function show(el: HTMLElement): void {
  const text = tipTextFor(el);
  if (!text) return;
  currentEl = el;
  placeTip(el);
  const move = (ev: MouseEvent) => {
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (currentEl === el) positionTip(lastX, lastY);
  };
  el.addEventListener("mousemove", move);
  el.addEventListener("mouseleave", hide, { once: true });
  el.addEventListener("blur", hide, { once: true });
  const kd = (ev: KeyboardEvent) => { if (ev.key === "Escape") hide(); };
  document.addEventListener("keydown", kd, { once: true });
}

function hide(): void {
  if (delayTimer) {
    clearTimeout(delayTimer);
    delayTimer = null;
  }
  currentEl = null;
  if (tip) tip.classList.remove("in");
}

export function setTip(el: HTMLElement, text: string, accentClass?: string): void {
  if (text) {
    el.setAttribute("data-tip", String(text));
    if (accentClass) {
      el.classList.remove("tip-warn");
      el.classList.add(accentClass);
    }
  } else {
    el.removeAttribute("data-tip");
  }
}

function delayThenShow(el: HTMLElement): void {
  delayTimer = setTimeout(() => {
    delayTimer = null;
    if (currentEl === el) show(el);
  }, SHOW_DELAY);
}

function onEnter(ev: MouseEvent): void {
  if (suppressed && suppressed()) {
    hide();
    return;
  }
  const el = ev.target instanceof Element ? ev.target.closest("[data-tip]") : null;
  if (el === currentEl) return;
  hide();
  if (!(el instanceof HTMLElement)) return;
  lastX = ev.clientX;
  lastY = ev.clientY;
  currentEl = el;
  delayThenShow(el);
}

/**
 * Optional predicate; when it returns true no tooltip will be shown (used by
 * the viewer to hide tooltips while an overlay popup/option/dialog is open).
 */
export function initTooltips(suppress?: () => boolean): void {
  if (initialized) return;
  initialized = true;
  suppressed = suppress || null;
  document.addEventListener("mouseover", onEnter);
}
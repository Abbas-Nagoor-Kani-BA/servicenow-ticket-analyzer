let tip = null;
let currentEl = null;
let initialized = false;

const OFFSET = 10;
const MARGIN = 10;
const SHOW_DELAY = 500;

let delayTimer = null;
let lastX = 0;
let lastY = 0;
let suppressed = null;

function ensureTip() {
  if (tip) return tip;
  tip = document.createElement("div");
  tip.className = "tip";
  document.body.appendChild(tip);
  return tip;
}

function tipTextFor(el) {
  const t = el.getAttribute("data-tip");
  if (t != null && t !== "") return t;
  return "";
}

function placeTip(el) {
  const root = ensureTip();
  const text = tipTextFor(el);
  if (!text) return;
  root.textContent = text;
  root.classList.remove("warn");
  if (el.classList.contains("tip-warn")) root.classList.add("warn");
  root.classList.add("in");
  positionTip(lastX, lastY);
}

function positionTip(x, y) {
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

function show(el) {
  const text = tipTextFor(el);
  if (!text) return;
  currentEl = el;
  placeTip(el);
  const move = ev => {
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (currentEl === el) positionTip(lastX, lastY);
  };
  el.addEventListener("mousemove", move);
  el.addEventListener("mouseleave", hide, { once: true });
  el.addEventListener("blur", hide, { once: true });
  const kd = ev => { if (ev.key === "Escape") hide(); };
  document.addEventListener("keydown", kd, { once: true });
}

function hide() {
  if (delayTimer) {
    clearTimeout(delayTimer);
    delayTimer = null;
  }
  currentEl = null;
  if (tip) tip.classList.remove("in");
}

function setTip(el, text, accentClass) {
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

function delayThenShow(el) {
  delayTimer = setTimeout(() => {
    delayTimer = null;
    if (currentEl === el) show(el);
  }, SHOW_DELAY);
}

function onEnter(ev) {
  if (suppressed && suppressed()) {
    hide();
    return;
  }
  const el = ev.target.closest("[data-tip]");
  if (!el) return;
  lastX = ev.clientX;
  lastY = ev.clientY;
  if (el === currentEl) return;
  hide();
  currentEl = el;
  delayThenShow(el);
}

/**
 * @param {(() => boolean) | null} [suppress] Optional predicate; when it returns
 *   true no tooltip will be shown (used by the viewer to hide tooltips while
 *   an overlay popup/option/dialog is open).
 */
function initTooltips(suppress) {
  if (initialized) return;
  initialized = true;
  suppressed = suppress || null;
  document.addEventListener("mouseover", onEnter);
}

export { initTooltips, setTip };

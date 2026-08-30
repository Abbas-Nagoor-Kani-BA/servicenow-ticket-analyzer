const CAP = 4;
const DURATIONS: Record<string, number> = { success: 2600, error: 4200, info: 3200 };

let stack: HTMLDivElement | null = null;

function ensureStack(): HTMLDivElement {
  if (stack) return stack;
  stack = document.createElement("div");
  stack.className = "toastStack";
  document.body.appendChild(stack);
  return stack;
}

function dismiss(node: HTMLElement): void {
  if (!node.isConnected || node.classList.contains("out")) return;
  node.classList.add("out");
  setTimeout(() => {
    node.remove();
    if (stack && !stack.childElementCount) {
      stack.remove();
      stack = null;
    }
  }, 200);
}

export function showToast(message: string, type: "success" | "error" | "info" = "success"): HTMLElement {
  const kind = ["success", "error", "info"].includes(type) ? type : "success";
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  el.addEventListener("click", () => dismiss(el));
  const s = ensureStack();
  s.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));
  if (s.childElementCount > CAP) dismiss(s.firstElementChild as HTMLElement);
  setTimeout(() => dismiss(el), DURATIONS[kind]);
  return el;
}
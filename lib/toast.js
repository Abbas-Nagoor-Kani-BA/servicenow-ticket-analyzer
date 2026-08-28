const CAP = 4;
const DURATIONS = { success: 2600, error: 4200, info: 3200 };

let stack = null;

function ensureStack() {
  if (stack) return stack;
  stack = document.createElement("div");
  stack.className = "toastStack";
  document.body.appendChild(stack);
  return stack;
}

function dismiss(node) {
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

function showToast(message, type = "success") {
  const kind = ["success", "error", "info"].includes(type) ? type : "success";
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  el.addEventListener("click", () => dismiss(el));
  const s = ensureStack();
  s.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));
  if (s.childElementCount > CAP) dismiss(s.firstElementChild);
  setTimeout(() => dismiss(el), DURATIONS[kind]);
  return el;
}

export { showToast };
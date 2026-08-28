export function createLogger(els) {
  const logLines = [];
  let errCount = 0;
  let logModalOpen = false;

  function renderLogLine(container, { time, text, cls }) {
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = `[${time}] ${text}`;
    line.style.color = cls === "error" ? "#f38ba8" : cls === "success" ? "#a6e3a1" : "";
    container.appendChild(line);
  }

  function log(text, cls = "") {
    els.logCard.classList.remove("hidden");
    if (cls === "error") {
      errCount++;
      els.logErrBadge.textContent = String(errCount);
      els.logErrBadge.classList.remove("hidden");
    }
    const entry = { time: new Date().toLocaleTimeString(), text, cls };
    logLines.push(entry);
    renderLogLine(els.log, entry);
    els.log.scrollTop = els.log.scrollHeight;
    if (logModalOpen) {
      renderLogLine(els.logMirror, entry);
      els.logMirror.scrollTop = els.logMirror.scrollHeight;
    }
  }

  function open() {
    logModalOpen = true;
    els.logMirror.innerHTML = "";
    for (const entry of logLines) renderLogLine(els.logMirror, entry);
    els.logMirror.scrollTop = els.logMirror.scrollHeight;
    els.logModal.classList.remove("hidden");
  }

  function close() {
    logModalOpen = false;
    els.logModal.classList.add("hidden");
  }

  els.logHead.addEventListener("click", open);
  els.logClose.addEventListener("click", close);
  els.logModal.addEventListener("click", (e) => {
    if (e.target === els.logModal) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && logModalOpen) close();
  });
  els.logCopy.addEventListener("click", () => {
    navigator.clipboard.writeText(logLines.map((l) => `[${l.time}] ${l.text}`).join("\n")).then(() => {
      els.logCopy.textContent = "Copied";
      setTimeout(() => {
        els.logCopy.textContent = "Copy all";
      }, 1500);
    }).catch(() => {
    });
  });

  return { log, open, close };
}

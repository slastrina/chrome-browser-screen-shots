import type { ZapCancelled, ZapDone } from "../lib/messages";

// Re-injection guard: a second zap request restarts cleanly.
declare global {
  interface Window {
    __pageSnapZapCleanup?: () => void;
  }
}

window.__pageSnapZapCleanup?.();

(() => {
  const hidden: Array<{ element: HTMLElement; display: string; priority: string }> = [];

  const highlight = document.createElement("div");
  highlight.style.cssText = [
    "position: fixed",
    "z-index: 2147483646",
    "pointer-events: none",
    "border: 2px solid #d33131",
    "background: rgba(211, 49, 49, 0.14)",
    "border-radius: 2px",
    "display: none"
  ].join(";");

  const toolbar = document.createElement("div");
  toolbar.style.cssText = [
    "position: fixed",
    "z-index: 2147483647",
    "top: 12px",
    "left: 50%",
    "transform: translateX(-50%)",
    "display: flex",
    "align-items: center",
    "gap: 10px",
    "padding: 8px 12px",
    "background: #102036",
    "color: #fff",
    "font: 12.5px system-ui, sans-serif",
    "border-radius: 10px",
    "box-shadow: 0 10px 30px rgba(3, 18, 40, 0.45)"
  ].join(";");

  const label = document.createElement("span");
  label.textContent = "Click elements to remove";

  const makeButton = (text: string, background: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.textContent = text;
    button.style.cssText = [
      "border: 0",
      "border-radius: 7px",
      "padding: 5px 12px",
      `background: ${background}`,
      "color: #fff",
      "font: 600 12.5px system-ui, sans-serif",
      "cursor: pointer"
    ].join(";");
    return button;
  };
  const captureButton = makeButton("Capture ✓", "#0f6fde");
  captureButton.id = "page-snap-zap-capture";
  const undoButton = makeButton("Undo", "#3a4c66");
  const cancelButton = makeButton("Cancel", "#3a4c66");

  toolbar.append(label, captureButton, undoButton, cancelButton);
  document.documentElement.append(highlight, toolbar);

  let target: HTMLElement | null = null;

  function removeUi(): void {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    highlight.remove();
    toolbar.remove();
    delete window.__pageSnapZapCleanup;
  }

  function restoreAll(): void {
    for (const entry of hidden) {
      entry.element.style.setProperty("display", entry.display, entry.priority);
      if (!entry.display) {
        entry.element.style.removeProperty("display");
      }
    }
    hidden.length = 0;
    chrome.runtime.onMessage.removeListener(onRestoreMessage);
  }

  function onRestoreMessage(message: unknown): void {
    if (typeof message === "object" && message !== null && (message as { kind?: string }).kind === "zap-restore") {
      restoreAll();
    }
  }

  function onMove(event: MouseEvent): void {
    if (toolbar.contains(event.target as Node)) {
      highlight.style.display = "none";
      target = null;
      return;
    }
    highlight.style.display = "none";
    target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    if (!target) {
      return;
    }
    const rect = target.getBoundingClientRect();
    highlight.style.display = "block";
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  }

  function onClick(event: MouseEvent): void {
    if (toolbar.contains(event.target as Node)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!target) {
      return;
    }
    hidden.push({
      element: target,
      display: target.style.getPropertyValue("display"),
      priority: target.style.getPropertyPriority("display")
    });
    target.style.setProperty("display", "none", "important");
    highlight.style.display = "none";
    target = null;
  }

  function finish(): void {
    removeUi();
    // Keep elements hidden for the capture; the background sends
    // zap-restore once the file is saved.
    chrome.runtime.onMessage.addListener(onRestoreMessage);
    const message: ZapDone = { kind: "zap-done" };
    void chrome.runtime.sendMessage(message);
  }

  function cancel(): void {
    restoreAll();
    removeUi();
    const message: ZapCancelled = { kind: "zap-cancelled" };
    void chrome.runtime.sendMessage(message);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Enter") {
      event.preventDefault();
      finish();
    }
  }

  captureButton.addEventListener("click", finish);
  undoButton.addEventListener("click", () => {
    const entry = hidden.pop();
    if (entry) {
      entry.element.style.setProperty("display", entry.display, entry.priority);
      if (!entry.display) {
        entry.element.style.removeProperty("display");
      }
    }
  });
  cancelButton.addEventListener("click", cancel);
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.__pageSnapZapCleanup = () => {
    restoreAll();
    removeUi();
  };
})();

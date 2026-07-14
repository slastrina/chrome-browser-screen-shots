import type { ElementPicked, PickCancelled } from "../lib/messages";

// Re-injection guard: a second click on "Pick an element" restarts cleanly.
declare global {
  interface Window {
    __pageSnapPickerCleanup?: () => void;
  }
}

window.__pageSnapPickerCleanup?.();

(() => {
  const highlight = document.createElement("div");
  highlight.style.cssText = [
    "position: fixed",
    "z-index: 2147483647",
    "pointer-events: none",
    "border: 2px solid #0f6fde",
    "background: rgba(15, 111, 222, 0.12)",
    "border-radius: 2px",
    "display: none"
  ].join(";");
  document.documentElement.appendChild(highlight);

  let target: Element | null = null;

  function cleanup(): void {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    highlight.remove();
    delete window.__pageSnapPickerCleanup;
  }

  function onMove(event: MouseEvent): void {
    highlight.style.display = "none";
    target = document.elementFromPoint(event.clientX, event.clientY);
    highlight.style.display = "block";
    if (!target) {
      return;
    }
    const rect = target.getBoundingClientRect();
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  }

  function onClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (!target) {
      return;
    }
    const rect = target.getBoundingClientRect();
    const message: ElementPicked = {
      kind: "element-picked",
      rect: {
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height)
      }
    };
    cleanup();
    void chrome.runtime.sendMessage(message);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    const message: PickCancelled = { kind: "pick-cancelled" };
    cleanup();
    void chrome.runtime.sendMessage(message);
  }

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.__pageSnapPickerCleanup = cleanup;
})();

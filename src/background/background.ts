import { DEVICE_PRESETS } from "../lib/devices";
import { buildFilename } from "../lib/filename";
import type { CaptureMode, CaptureResponse, PageRect } from "../lib/messages";
import { isMessage } from "../lib/messages";
import { clearDeviceMetrics, expandViewport, screenshot, setDeviceMetrics, withDebugger } from "./cdp";

interface ActiveTab {
  id: number;
  url: string;
  windowId: number;
}

const UNCAPTURABLE = /^(chrome|chrome-extension|devtools|edge|about):/;

async function activeTab(): Promise<ActiveTab> {
  // Prefer the focused window's active tab, but skip browser/extension pages
  // (e.g. the popup opened as a tab) and fall back to other windows.
  const focused = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const all = await chrome.tabs.query({ active: true });
  const ordered = [...focused, ...all.filter((t) => !focused.some((f) => f.id === t.id))];
  const tab = ordered.find(
    (t) => t.id && t.url && !UNCAPTURABLE.test(t.url) && !t.url.startsWith("https://chromewebstore.google.com")
  );
  if (!tab?.id || !tab.url) {
    throw new Error("This page cannot be captured (browser-internal page).");
  }
  return { id: tab.id, url: tab.url, windowId: tab.windowId };
}

async function download(dataUrl: string, mode: CaptureMode, url: string, deviceName?: string): Promise<string> {
  const filename = buildFilename({ url, mode, deviceName, timestamp: new Date() });
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
  return filename;
}

const reflowDelay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function captureViewport(tab: ActiveTab): Promise<string[]> {
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return [await download(dataUrl, "viewport", tab.url)];
}

async function captureFullPage(tab: ActiveTab): Promise<string[]> {
  return withDebugger(tab.id, async () => {
    try {
      await expandViewport(tab.id, { deviceScaleFactor: 1, mobile: false });
      const dataUrl = await screenshot(tab.id);
      return [await download(dataUrl, "full-page", tab.url)];
    } finally {
      await clearDeviceMetrics(tab.id).catch(() => {
        // Detaching the debugger clears emulation anyway.
      });
    }
  });
}

async function captureElement(tab: ActiveTab, rect: PageRect): Promise<string[]> {
  return withDebugger(tab.id, async () => {
    try {
      // Expand so elements below the fold are on the rendered surface.
      await expandViewport(tab.id, { deviceScaleFactor: 1, mobile: false });
      const dataUrl = await screenshot(tab.id, { ...rect, scale: 1 });
      return [await download(dataUrl, "element", tab.url)];
    } finally {
      await clearDeviceMetrics(tab.id).catch(() => {
        // Detaching the debugger clears emulation anyway.
      });
    }
  });
}

async function captureDevices(tab: ActiveTab): Promise<string[]> {
  return withDebugger(tab.id, async () => {
    try {
      const filenames: string[] = [];
      for (const preset of DEVICE_PRESETS) {
        // Render at the preset's real viewport first so responsive layout
        // applies, then grow to full height for the capture.
        await setDeviceMetrics(tab.id, preset);
        await reflowDelay(400);
        await expandViewport(tab.id, preset);
        const dataUrl = await screenshot(tab.id);
        filenames.push(await download(dataUrl, "device", tab.url, preset.name));
      }
      return filenames;
    } finally {
      await clearDeviceMetrics(tab.id).catch(() => {
        // Detaching the debugger clears emulation anyway.
      });
    }
  });
}

async function startElementPick(tab: ActiveTab): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["picker.js"]
  });
}

async function flashBadge(text: string, color: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => void chrome.action.setBadgeText({ text: "" }), 2500);
}

async function runCapture(mode: CaptureMode): Promise<CaptureResponse> {
  const tab = await activeTab();
  switch (mode) {
    case "viewport":
      return { ok: true, filenames: await captureViewport(tab) };
    case "full-page":
      return { ok: true, filenames: await captureFullPage(tab) };
    case "device":
      return { ok: true, filenames: await captureDevices(tab) };
    case "element":
      await startElementPick(tab);
      return { ok: true, pending: true };
  }
}

// Lets the e2e suite drive captures directly from the service worker.
(globalThis as { __pageSnapCapture?: typeof runCapture }).__pageSnapCapture = runCapture;

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (r: CaptureResponse) => void) => {
  if (!isMessage(message)) {
    return false;
  }

  if (message.kind === "capture") {
    runCapture(message.mode)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.kind === "element-picked") {
    activeTab()
      .then((tab) => captureElement(tab, message.rect))
      .then(() => flashBadge("✓", "#1a7f37"))
      .catch(() => flashBadge("!", "#b91c1c"));
    return false;
  }

  return false;
});

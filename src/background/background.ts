import { DEVICE_PRESETS } from "../lib/devices";
import { buildFilename } from "../lib/filename";
import type {
  CaptureFormat,
  CaptureMode,
  CaptureResponse,
  CaptureTheme,
  PageRect,
  PdfLayout
} from "../lib/messages";
import { isMessage } from "../lib/messages";
import { jpegsToPdf } from "../lib/pdf";
import type { ImageEncoding } from "./cdp";
import {
  clearDeviceMetrics,
  expandViewport,
  screenshot,
  setColorScheme,
  setDeviceMetrics,
  withDebugger
} from "./cdp";

interface ActiveTab {
  id: number;
  url: string;
  windowId: number;
}

interface CaptureOptions {
  format: CaptureFormat;
  pdfLayout: PdfLayout;
  theme: CaptureTheme;
}

interface Shot {
  dataUrl: string;
  deviceName?: string;
  themeName?: string;
}

const JPG_QUALITY = 92;
const PDF_JPEG_QUALITY = 95;

const DEFAULT_OPTIONS: CaptureOptions = { format: "png", pdfLayout: "single", theme: "none" };

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

/** PNG stays lossless; JPG and PDF (which embeds JPEG) render as JPEG. */
function imageEncoding(format: CaptureFormat): ImageEncoding {
  if (format === "png") {
    return { format: "png" };
  }
  return { format: "jpeg", quality: format === "pdf" ? PDF_JPEG_QUALITY : JPG_QUALITY };
}

function themeList(theme: CaptureTheme): Array<"light" | "dark" | null> {
  switch (theme) {
    case "none":
      return [null];
    case "light":
      return ["light"];
    case "dark":
      return ["dark"];
    case "both":
      return ["light", "dark"];
  }
}

function dataUrlToBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function imageSize(bytes: Uint8Array<ArrayBuffer>): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

async function download(
  dataUrl: string,
  mode: CaptureMode,
  url: string,
  extension: "png" | "jpg" | "pdf",
  deviceName?: string,
  themeName?: string
): Promise<string> {
  const filename = buildFilename({ url, mode, extension, deviceName, themeName, timestamp: new Date() });
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
  return filename;
}

async function toPdfDataUrl(shots: Shot[]): Promise<string> {
  const images = await Promise.all(
    shots.map(async (shot) => {
      const jpeg = dataUrlToBytes(shot.dataUrl);
      return { ...(await imageSize(jpeg)), jpeg };
    })
  );
  return `data:application/pdf;base64,${bytesToBase64(jpegsToPdf(images))}`;
}

async function saveShots(shots: Shot[], mode: CaptureMode, url: string, opts: CaptureOptions): Promise<string[]> {
  if (opts.format !== "pdf") {
    const filenames: string[] = [];
    for (const shot of shots) {
      filenames.push(await download(shot.dataUrl, mode, url, opts.format, shot.deviceName, shot.themeName));
    }
    return filenames;
  }
  if (opts.pdfLayout === "single" || shots.length === 1) {
    return [await download(await toPdfDataUrl(shots), mode, url, "pdf")];
  }
  const filenames: string[] = [];
  for (const shot of shots) {
    filenames.push(await download(await toPdfDataUrl([shot]), mode, url, "pdf", shot.deviceName, shot.themeName));
  }
  return filenames;
}

const reflowDelay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Take one shot per requested theme in the current debugger session. */
async function themedShots(
  tabId: number,
  opts: CaptureOptions,
  take: () => Promise<string>,
  extra?: Partial<Shot>
): Promise<Shot[]> {
  const shots: Shot[] = [];
  for (const scheme of themeList(opts.theme)) {
    if (scheme) {
      await setColorScheme(tabId, scheme);
      await reflowDelay(250);
    }
    shots.push({ ...extra, dataUrl: await take(), themeName: scheme ?? undefined });
  }
  if (opts.theme !== "none") {
    await setColorScheme(tabId, null).catch(() => {
      // Detaching the debugger clears emulation anyway.
    });
  }
  return shots;
}

async function captureViewport(tab: ActiveTab, opts: CaptureOptions): Promise<Shot[]> {
  const encoding = imageEncoding(opts.format);
  if (opts.theme === "none") {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: encoding.format,
      ...(encoding.format === "jpeg" ? { quality: encoding.quality } : {})
    });
    return [{ dataUrl }];
  }
  // Theme emulation needs the debugger; capture the bare viewport via CDP.
  return withDebugger(tab.id, () => themedShots(tab.id, opts, () => screenshot(tab.id, encoding)));
}

async function captureFullPage(tab: ActiveTab, opts: CaptureOptions): Promise<Shot[]> {
  return withDebugger(tab.id, async () => {
    try {
      await expandViewport(tab.id, { deviceScaleFactor: 1, mobile: false });
      return await themedShots(tab.id, opts, () => screenshot(tab.id, imageEncoding(opts.format)));
    } finally {
      await clearDeviceMetrics(tab.id).catch(() => {
        // Detaching the debugger clears emulation anyway.
      });
    }
  });
}

async function captureElement(tab: ActiveTab, rect: PageRect, opts: CaptureOptions): Promise<Shot[]> {
  return withDebugger(tab.id, async () => {
    try {
      // Expand so elements below the fold are on the rendered surface.
      await expandViewport(tab.id, { deviceScaleFactor: 1, mobile: false });
      return await themedShots(tab.id, opts, () =>
        screenshot(tab.id, imageEncoding(opts.format), { ...rect, scale: 1 })
      );
    } finally {
      await clearDeviceMetrics(tab.id).catch(() => {
        // Detaching the debugger clears emulation anyway.
      });
    }
  });
}

async function captureDevices(tab: ActiveTab, opts: CaptureOptions): Promise<Shot[]> {
  return withDebugger(tab.id, async () => {
    try {
      const shots: Shot[] = [];
      for (const preset of DEVICE_PRESETS) {
        // Render at the preset's real viewport first so responsive layout
        // applies, then grow to full height for the capture.
        await setDeviceMetrics(tab.id, preset);
        await reflowDelay(400);
        await expandViewport(tab.id, preset);
        shots.push(
          ...(await themedShots(tab.id, opts, () => screenshot(tab.id, imageEncoding(opts.format)), {
            deviceName: preset.name
          }))
        );
      }
      return shots;
    } finally {
      await clearDeviceMetrics(tab.id).catch(() => {
        // Detaching the debugger clears emulation anyway.
      });
    }
  });
}

async function injectScript(tab: ActiveTab, file: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: [file]
  });
}

async function flashBadge(text: string, color: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => void chrome.action.setBadgeText({ text: "" }), 2500);
}

function badgeOk(): void {
  void flashBadge("✓", "#1a7f37");
}
function badgeError(): void {
  void flashBadge("!", "#b91c1c");
}

async function captureShots(tab: ActiveTab, mode: CaptureMode, opts: CaptureOptions): Promise<Shot[]> {
  switch (mode) {
    case "viewport":
      return captureViewport(tab, opts);
    case "full-page":
      return captureFullPage(tab, opts);
    case "device":
      return captureDevices(tab, opts);
    case "element":
      throw new Error("Element captures go through the picker.");
  }
}

// The popup closes when a picker or zapper takes over, so the options for
// the eventual capture are held here until the content script reports back.
let pendingElementOptions: CaptureOptions = DEFAULT_OPTIONS;
let pendingZap: { mode: CaptureMode; opts: CaptureOptions } | null = null;
let zapRestoreTabId: number | null = null;

async function restoreZapped(tabId: number): Promise<void> {
  if (zapRestoreTabId === tabId) {
    zapRestoreTabId = null;
    await chrome.tabs.sendMessage(tabId, { kind: "zap-restore" }).catch(() => {
      // Tab navigated or closed; nothing to restore.
    });
  }
}

async function runCapture(mode: CaptureMode, opts: CaptureOptions, zapFirst = false): Promise<CaptureResponse> {
  const tab = await activeTab();
  if (zapFirst) {
    pendingZap = { mode, opts };
    await injectScript(tab, "zapper.js");
    return { ok: true, pending: true };
  }
  if (mode === "element") {
    pendingElementOptions = opts;
    await injectScript(tab, "picker.js");
    return { ok: true, pending: true };
  }
  const filenames = await saveShots(await captureShots(tab, mode, opts), mode, tab.url, opts);
  await restoreZapped(tab.id);
  return { ok: true, filenames };
}

/** Capture a single PNG and return it as a data URL for the clipboard. */
async function runCopy(mode: CaptureMode, theme: CaptureTheme): Promise<CaptureResponse> {
  if (mode !== "viewport" && mode !== "full-page") {
    throw new Error("Copy works for viewport and full-page captures.");
  }
  const tab = await activeTab();
  const opts: CaptureOptions = { format: "png", pdfLayout: "single", theme: theme === "both" ? "none" : theme };
  const shots = await captureShots(tab, mode, opts);
  const shot = shots[0];
  if (!shot) {
    throw new Error("Capture produced no image.");
  }
  return { ok: true, dataUrl: shot.dataUrl };
}

// Lets the e2e suite drive captures directly from the service worker.
(globalThis as {
  __pageSnapCapture?: (
    mode: CaptureMode,
    format?: CaptureFormat,
    pdfLayout?: PdfLayout,
    theme?: CaptureTheme,
    zapFirst?: boolean
  ) => Promise<CaptureResponse>;
}).__pageSnapCapture = (mode, format = "png", pdfLayout = "single", theme = "none", zapFirst = false) =>
  runCapture(mode, { format, pdfLayout, theme }, zapFirst);

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (r: CaptureResponse) => void) => {
  if (!isMessage(message)) {
    return false;
  }

  if (message.kind === "capture") {
    const opts: CaptureOptions = { format: message.format, pdfLayout: message.pdfLayout, theme: message.theme };
    const work = message.copy ? runCopy(message.mode, message.theme) : runCapture(message.mode, opts, message.zapFirst);
    work
      .then(sendResponse)
      .catch((error: unknown) =>
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) })
      );
    return true;
  }

  if (message.kind === "element-picked") {
    const opts = pendingElementOptions;
    activeTab()
      .then(async (tab) => {
        await saveShots(await captureElement(tab, message.rect, opts), "element", tab.url, opts);
        await restoreZapped(tab.id);
      })
      .then(badgeOk)
      .catch(badgeError);
    return false;
  }

  if (message.kind === "zap-done") {
    const pending = pendingZap;
    pendingZap = null;
    if (!pending) {
      return false;
    }
    activeTab()
      .then(async (tab) => {
        zapRestoreTabId = tab.id;
        if (pending.mode === "element") {
          pendingElementOptions = pending.opts;
          await injectScript(tab, "picker.js");
          return;
        }
        const filenames = await saveShots(await captureShots(tab, pending.mode, pending.opts), pending.mode, tab.url, pending.opts);
        await restoreZapped(tab.id);
        if (filenames.length > 0) {
          badgeOk();
        }
      })
      .catch(() => {
        zapRestoreTabId = null;
        badgeError();
      });
    return false;
  }

  if (message.kind === "zap-cancelled" || message.kind === "pick-cancelled") {
    pendingZap = null;
    zapRestoreTabId = null;
    return false;
  }

  return false;
});

const COMMAND_MODES: Record<string, CaptureMode> = {
  "capture-viewport": "viewport",
  "capture-full-page": "full-page",
  "capture-element": "element"
};

chrome.commands.onCommand.addListener((command) => {
  const mode = COMMAND_MODES[command];
  if (!mode) {
    return;
  }
  void (async () => {
    const stored = await chrome.storage.local.get(["lastFormat", "lastPdfLayout", "lastTheme"]);
    const opts: CaptureOptions = {
      format: (stored.lastFormat as CaptureFormat) ?? "png",
      pdfLayout: (stored.lastPdfLayout as PdfLayout) ?? "single",
      theme: (stored.lastTheme as CaptureTheme) ?? "none"
    };
    try {
      const result = await runCapture(mode, opts);
      if (result.ok && !("pending" in result)) {
        badgeOk();
      }
    } catch {
      badgeError();
    }
  })();
});

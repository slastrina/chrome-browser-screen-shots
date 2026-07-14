import { DEVICE_PRESETS } from "../lib/devices";
import { buildFilename } from "../lib/filename";
import type { CaptureFormat, CaptureMode, CaptureResponse, PageRect, PdfLayout } from "../lib/messages";
import { isMessage } from "../lib/messages";
import { jpegsToPdf } from "../lib/pdf";
import type { ImageEncoding } from "./cdp";
import { clearDeviceMetrics, expandViewport, screenshot, setDeviceMetrics, withDebugger } from "./cdp";

interface ActiveTab {
  id: number;
  url: string;
  windowId: number;
}

interface CaptureOptions {
  format: CaptureFormat;
  pdfLayout: PdfLayout;
}

interface Shot {
  dataUrl: string;
  deviceName?: string;
}

const JPG_QUALITY = 92;
const PDF_JPEG_QUALITY = 95;

const DEFAULT_OPTIONS: CaptureOptions = { format: "png", pdfLayout: "single" };

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
  deviceName?: string
): Promise<string> {
  const filename = buildFilename({ url, mode, extension, deviceName, timestamp: new Date() });
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
      filenames.push(await download(shot.dataUrl, mode, url, opts.format, shot.deviceName));
    }
    return filenames;
  }
  if (opts.pdfLayout === "single" || shots.length === 1) {
    return [await download(await toPdfDataUrl(shots), mode, url, "pdf")];
  }
  const filenames: string[] = [];
  for (const shot of shots) {
    filenames.push(await download(await toPdfDataUrl([shot]), mode, url, "pdf", shot.deviceName));
  }
  return filenames;
}

const reflowDelay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function captureViewport(tab: ActiveTab, opts: CaptureOptions): Promise<Shot[]> {
  const encoding = imageEncoding(opts.format);
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: encoding.format,
    ...(encoding.format === "jpeg" ? { quality: encoding.quality } : {})
  });
  return [{ dataUrl }];
}

async function captureFullPage(tab: ActiveTab, opts: CaptureOptions): Promise<Shot[]> {
  return withDebugger(tab.id, async () => {
    try {
      await expandViewport(tab.id, { deviceScaleFactor: 1, mobile: false });
      return [{ dataUrl: await screenshot(tab.id, imageEncoding(opts.format)) }];
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
      return [{ dataUrl: await screenshot(tab.id, imageEncoding(opts.format), { ...rect, scale: 1 }) }];
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
        shots.push({ dataUrl: await screenshot(tab.id, imageEncoding(opts.format)), deviceName: preset.name });
      }
      return shots;
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

// The popup closes when element picking starts, so the options for the
// eventual capture are held here until the picker reports back.
let pendingElementOptions: CaptureOptions = DEFAULT_OPTIONS;

async function runCapture(mode: CaptureMode, opts: CaptureOptions): Promise<CaptureResponse> {
  const tab = await activeTab();
  switch (mode) {
    case "viewport":
      return { ok: true, filenames: await saveShots(await captureViewport(tab, opts), mode, tab.url, opts) };
    case "full-page":
      return { ok: true, filenames: await saveShots(await captureFullPage(tab, opts), mode, tab.url, opts) };
    case "device":
      return { ok: true, filenames: await saveShots(await captureDevices(tab, opts), mode, tab.url, opts) };
    case "element":
      pendingElementOptions = opts;
      await startElementPick(tab);
      return { ok: true, pending: true };
  }
}

// Lets the e2e suite drive captures directly from the service worker.
(globalThis as { __pageSnapCapture?: (mode: CaptureMode, format?: CaptureFormat, pdfLayout?: PdfLayout) => Promise<CaptureResponse> }).__pageSnapCapture =
  (mode, format = "png", pdfLayout = "single") => runCapture(mode, { format, pdfLayout });

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse: (r: CaptureResponse) => void) => {
  if (!isMessage(message)) {
    return false;
  }

  if (message.kind === "capture") {
    runCapture(message.mode, { format: message.format, pdfLayout: message.pdfLayout })
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message.kind === "element-picked") {
    const opts = pendingElementOptions;
    activeTab()
      .then(async (tab) => saveShots(await captureElement(tab, message.rect, opts), "element", tab.url, opts))
      .then(() => flashBadge("✓", "#1a7f37"))
      .catch(() => flashBadge("!", "#b91c1c"));
    return false;
  }

  return false;
});

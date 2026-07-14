// Chrome caps screenshot textures; keep surfaces under this many device px tall.
const MAX_CAPTURE_PX = 16384;

interface LayoutMetrics {
  cssLayoutViewport: { clientWidth: number; clientHeight: number };
  cssContentSize: { x: number; y: number; width: number; height: number };
}

interface ScreenshotResult {
  data: string;
}

function send<T>(tabId: number, method: string, params?: object): Promise<T> {
  return chrome.debugger.sendCommand({ tabId }, method, params) as Promise<T>;
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withDebugger<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    return await fn();
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {
      // Tab may have closed mid-capture; nothing left to detach from.
    });
  }
}

async function pageMetrics(tabId: number): Promise<{ viewportWidth: number; contentHeight: number }> {
  const m = await send<LayoutMetrics>(tabId, "Page.getLayoutMetrics");
  return {
    viewportWidth: Math.round(m.cssLayoutViewport.clientWidth),
    contentHeight: Math.ceil(m.cssContentSize.height)
  };
}

export async function setDeviceMetrics(
  tabId: number,
  metrics: { width: number; height: number; deviceScaleFactor: number; mobile: boolean }
): Promise<void> {
  await send(tabId, "Emulation.setDeviceMetricsOverride", metrics);
}

export async function clearDeviceMetrics(tabId: number): Promise<void> {
  await send(tabId, "Emulation.clearDeviceMetricsOverride");
}

/**
 * Grow the viewport to the page's full content height so the whole page
 * renders in one real layout pass, then re-measure until the height settles
 * (lazy-loaded content can extend the page once it becomes visible).
 *
 * This is how DevTools' own "capture full size screenshot" works. The
 * simpler captureBeyondViewport flag is not used because it repeats
 * viewport-sized tiles on pages with sticky or viewport-relative layout.
 */
export async function expandViewport(
  tabId: number,
  opts: { width?: number; deviceScaleFactor: number; mobile: boolean }
): Promise<void> {
  const maxCssHeight = Math.floor(MAX_CAPTURE_PX / Math.max(1, opts.deviceScaleFactor));
  let metrics = await pageMetrics(tabId);
  const width = opts.width ?? metrics.viewportWidth;
  let height = 0;
  for (let pass = 0; pass < 3; pass++) {
    const target = Math.min(metrics.contentHeight, maxCssHeight);
    if (target === height) {
      break;
    }
    height = target;
    await setDeviceMetrics(tabId, {
      width,
      height,
      deviceScaleFactor: opts.deviceScaleFactor,
      mobile: opts.mobile
    });
    await settle(pass === 0 ? 400 : 250);
    metrics = await pageMetrics(tabId);
  }
}

export interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export async function screenshot(tabId: number, clip?: Clip): Promise<string> {
  const result = await send<ScreenshotResult>(tabId, "Page.captureScreenshot", {
    format: "png",
    ...(clip ? { clip } : {})
  });
  return `data:image/png;base64,${result.data}`;
}

// Chrome caps screenshot textures; clip anything taller to avoid a blank capture.
const MAX_CAPTURE_CSS_PX = 16384;

interface LayoutMetrics {
  cssContentSize: { x: number; y: number; width: number; height: number };
}

interface ScreenshotResult {
  data: string;
}

function send<T>(tabId: number, method: string, params?: object): Promise<T> {
  return chrome.debugger.sendCommand({ tabId }, method, params) as Promise<T>;
}

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

export async function contentSize(tabId: number): Promise<{ width: number; height: number }> {
  const metrics = await send<LayoutMetrics>(tabId, "Page.getLayoutMetrics");
  return {
    width: Math.ceil(metrics.cssContentSize.width),
    height: Math.min(Math.ceil(metrics.cssContentSize.height), MAX_CAPTURE_CSS_PX)
  };
}

export interface Clip {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

export async function screenshot(tabId: number, clip: Clip): Promise<string> {
  const result = await send<ScreenshotResult>(tabId, "Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: {
      ...clip,
      height: Math.min(clip.height, MAX_CAPTURE_CSS_PX)
    }
  });
  return `data:image/png;base64,${result.data}`;
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

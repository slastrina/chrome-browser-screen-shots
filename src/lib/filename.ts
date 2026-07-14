import type { CaptureMode } from "./messages";

export interface CaptureContext {
  url: string;
  mode: CaptureMode;
  extension: "png" | "jpg" | "pdf";
  deviceName?: string;
  timestamp: Date;
}

function hostSlug(url: string): string {
  try {
    const host = new URL(url).hostname;
    const slug = host.replace(/^www\./, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return slug || "page";
  } catch {
    return "page";
  }
}

/** `example-com--full-page--2026-07-15T08-30-00.png` */
export function buildFilename(ctx: CaptureContext): string {
  const stamp = ctx.timestamp.toISOString().slice(0, 19).replace(/:/g, "-");
  const parts = [hostSlug(ctx.url), ctx.mode, ctx.deviceName, stamp].filter(Boolean);
  return `${parts.join("--")}.${ctx.extension}`;
}

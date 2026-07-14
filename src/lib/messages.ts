export type CaptureMode = "viewport" | "full-page" | "element" | "device";

export type CaptureFormat = "png" | "jpg" | "pdf";

/** For PDF + device sizes: one multi-page file, or one file per size. */
export type PdfLayout = "single" | "multiple";

/** Emulated prefers-color-scheme for the capture; "both" captures a pair. */
export type CaptureTheme = "none" | "light" | "dark" | "both";

export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureRequest {
  kind: "capture";
  mode: CaptureMode;
  format: CaptureFormat;
  pdfLayout: PdfLayout;
  theme: CaptureTheme;
  zapFirst: boolean;
  /** Return the capture as a PNG data URL for the clipboard instead of downloading. */
  copy: boolean;
}

export interface ElementPicked {
  kind: "element-picked";
  rect: PageRect;
}

export interface PickCancelled {
  kind: "pick-cancelled";
}

/** Zapper finished hiding elements; run the pending capture. */
export interface ZapDone {
  kind: "zap-done";
}

export interface ZapCancelled {
  kind: "zap-cancelled";
}

/** Background → tab: capture finished, un-hide zapped elements. */
export interface ZapRestore {
  kind: "zap-restore";
}

export type Message = CaptureRequest | ElementPicked | PickCancelled | ZapDone | ZapCancelled | ZapRestore;

export type CaptureResponse =
  | { ok: true; filenames: string[] }
  | { ok: true; dataUrl: string }
  | { ok: true; pending: true }
  | { ok: false; error: string };

const KINDS = new Set(["capture", "element-picked", "pick-cancelled", "zap-done", "zap-cancelled", "zap-restore"]);

export function isMessage(value: unknown): value is Message {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  return KINDS.has((value as { kind: string }).kind);
}

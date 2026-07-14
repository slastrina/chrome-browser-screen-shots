export type CaptureMode = "viewport" | "full-page" | "element" | "device";

export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureRequest {
  kind: "capture";
  mode: CaptureMode;
}

export interface ElementPicked {
  kind: "element-picked";
  rect: PageRect;
}

export interface PickCancelled {
  kind: "pick-cancelled";
}

export type Message = CaptureRequest | ElementPicked | PickCancelled;

export type CaptureResponse =
  | { ok: true; filenames: string[] }
  | { ok: true; pending: true }
  | { ok: false; error: string };

export function isMessage(value: unknown): value is Message {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  const kind = (value as { kind: unknown }).kind;
  return kind === "capture" || kind === "element-picked" || kind === "pick-cancelled";
}

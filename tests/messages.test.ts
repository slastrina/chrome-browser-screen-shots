import { describe, expect, it } from "vitest";
import { isMessage } from "../src/lib/messages";

describe("isMessage", () => {
  it("accepts every message kind", () => {
    expect(isMessage({ kind: "capture", mode: "viewport" })).toBe(true);
    expect(isMessage({ kind: "element-picked", rect: { x: 0, y: 0, width: 1, height: 1 } })).toBe(true);
    expect(isMessage({ kind: "pick-cancelled" })).toBe(true);
  });

  it("rejects non-messages", () => {
    expect(isMessage(null)).toBe(false);
    expect(isMessage(undefined)).toBe(false);
    expect(isMessage("capture")).toBe(false);
    expect(isMessage({ kind: "other" })).toBe(false);
    expect(isMessage({})).toBe(false);
  });
});

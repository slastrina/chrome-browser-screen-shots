import { describe, expect, it } from "vitest";
import { DEVICE_PRESETS } from "../src/lib/devices";

describe("DEVICE_PRESETS", () => {
  it("defines mobile, tablet and desktop at the specced widths", () => {
    expect(DEVICE_PRESETS.map((p) => [p.name, p.width])).toEqual([
      ["mobile", 390],
      ["tablet", 820],
      ["desktop", 1440]
    ]);
  });

  it("uses positive integer dimensions and scale factors", () => {
    for (const p of DEVICE_PRESETS) {
      expect(Number.isInteger(p.width) && p.width > 0).toBe(true);
      expect(Number.isInteger(p.height) && p.height > 0).toBe(true);
      expect(p.deviceScaleFactor).toBeGreaterThan(0);
    }
  });
});

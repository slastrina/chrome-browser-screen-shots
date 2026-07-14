import { describe, expect, it } from "vitest";
import { buildFilename } from "../src/lib/filename";

const stamp = new Date("2026-07-15T08:30:00Z");

describe("buildFilename", () => {
  it("builds host--mode--stamp", () => {
    expect(buildFilename({ url: "https://example.com/pricing", mode: "full-page", timestamp: stamp }))
      .toBe("example-com--full-page--2026-07-15T08-30-00.png");
  });

  it("includes the device name when present", () => {
    expect(buildFilename({ url: "https://example.com", mode: "device", deviceName: "mobile", timestamp: stamp }))
      .toBe("example-com--device--mobile--2026-07-15T08-30-00.png");
  });

  it("strips a leading www and non-alphanumerics", () => {
    expect(buildFilename({ url: "https://www.foo.co.uk:8080/x", mode: "viewport", timestamp: stamp }))
      .toBe("foo-co-uk--viewport--2026-07-15T08-30-00.png");
  });

  it("falls back to 'page' for URLs without a usable host", () => {
    expect(buildFilename({ url: "file:///Users/me/index.html", mode: "viewport", timestamp: stamp }))
      .toBe("page--viewport--2026-07-15T08-30-00.png");
    expect(buildFilename({ url: "not a url", mode: "viewport", timestamp: stamp }))
      .toBe("page--viewport--2026-07-15T08-30-00.png");
  });

  it("never produces path separators or colons", () => {
    const name = buildFilename({ url: "https://a.b/c://d\\e", mode: "element", timestamp: stamp });
    expect(name).not.toMatch(/[/\\:]/);
  });
});

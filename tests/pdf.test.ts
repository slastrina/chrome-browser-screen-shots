import { describe, expect, it } from "vitest";
import { jpegsToPdf } from "../src/lib/pdf";

const fakeJpeg = (fill: number, length = 64): Uint8Array => {
  const bytes = new Uint8Array(length).fill(fill);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
};

const asText = (bytes: Uint8Array): string => new TextDecoder("latin1").decode(bytes);

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("jpegsToPdf", () => {
  it("builds a single-page PDF around one image", () => {
    const pdf = asText(jpegsToPdf([{ width: 100, height: 50, jpeg: fakeJpeg(1) }]));
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.endsWith("%%EOF\n")).toBe(true);
    expect(pdf).toContain("/Count 1");
    expect(count(pdf, "/Subtype /Image")).toBe(1);
    // 100px x 50px at 0.75pt/px
    expect(pdf).toContain("/MediaBox [0 0 75.00 37.50]");
    expect(pdf).toContain("/Width 100 /Height 50");
  });

  it("builds one page per image in order", () => {
    const pdf = asText(
      jpegsToPdf([
        { width: 390, height: 800, jpeg: fakeJpeg(1) },
        { width: 820, height: 900, jpeg: fakeJpeg(2) },
        { width: 1440, height: 700, jpeg: fakeJpeg(3) }
      ])
    );
    expect(pdf).toContain("/Count 3");
    expect(count(pdf, "/Subtype /Image")).toBe(3);
    expect(pdf.indexOf("/Width 390")).toBeLessThan(pdf.indexOf("/Width 820"));
    expect(pdf.indexOf("/Width 820")).toBeLessThan(pdf.indexOf("/Width 1440"));
  });

  it("embeds the JPEG bytes verbatim", () => {
    const jpeg = fakeJpeg(7, 32);
    const pdf = jpegsToPdf([{ width: 10, height: 10, jpeg }]);
    const text = asText(pdf);
    const streamStart = text.indexOf("stream\n", text.indexOf("/DCTDecode")) + "stream\n".length;
    expect(Array.from(pdf.slice(streamStart, streamStart + 32))).toEqual(Array.from(jpeg));
  });

  it("writes a correct xref table", () => {
    const bytes = jpegsToPdf([{ width: 10, height: 10, jpeg: fakeJpeg(1) }]);
    const text = asText(bytes);
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n /gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5); // catalog, pages, page, image, contents
    for (const [index, offset] of offsets.entries()) {
      expect(text.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`);
    }
    const startxref = Number(text.match(/startxref\n(\d+)/)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
  });

  it("rejects an empty image list", () => {
    expect(() => jpegsToPdf([])).toThrow();
  });
});

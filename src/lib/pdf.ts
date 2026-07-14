export interface PdfImage {
  width: number;
  height: number;
  jpeg: Uint8Array;
}

// 1 CSS px = 0.75 pt (96 dpi). Also keeps a max-height capture (16384px)
// inside the 14400pt page-dimension limit some PDF viewers enforce.
const PX_TO_PT = 0.75;

/**
 * Build a PDF with one page per JPEG image, each page sized to its image.
 * JPEG streams embed directly via DCTDecode, so no image re-encoding and no
 * dependencies are needed.
 */
export function jpegsToPdf(images: PdfImage[]): Uint8Array {
  if (images.length === 0) {
    throw new Error("Cannot build a PDF with no pages.");
  }

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let position = 0;

  const push = (data: Uint8Array | string): void => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    chunks.push(bytes);
    position += bytes.length;
  };
  const beginObject = (num: number): void => {
    offsets[num] = position;
    push(`${num} 0 obj\n`);
  };

  push("%PDF-1.4\n");

  const objectCount = 2 + images.length * 3;
  const kids = images.map((_, i) => `${3 + i * 3} 0 R`).join(" ");
  beginObject(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  beginObject(2);
  push(`<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>\nendobj\n`);

  images.forEach((img, i) => {
    const pageNum = 3 + i * 3;
    const imageNum = pageNum + 1;
    const contentNum = pageNum + 2;
    const w = (img.width * PX_TO_PT).toFixed(2);
    const h = (img.height * PX_TO_PT).toFixed(2);

    beginObject(pageNum);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
        `/Resources << /XObject << /Im${i} ${imageNum} 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`
    );

    beginObject(imageNum);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`
    );
    push(img.jpeg);
    push("\nendstream\nendobj\n");

    const content = `q ${w} 0 0 ${h} 0 0 cm /Im${i} Do Q`;
    beginObject(contentNum);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  });

  const xrefStart = position;
  push(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`);
  for (let num = 1; num <= objectCount; num++) {
    push(`${String(offsets[num]).padStart(10, "0")} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  const out = new Uint8Array(position);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

import { expect, test } from "@playwright/test";
import type { BrowserContext, Worker } from "@playwright/test";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const dist = resolve(here, "../dist");
const stateDir = resolve(here, "../test-results/e2e-state");
// The production manifest deliberately has no host permissions (activeTab
// covers real usage, granted by clicking the popup). Tests drive the service
// worker directly with no user gesture, so stage a copy of the build with
// host access added.
const extensionDir = join(stateDir, "extension");
const fixtureHtml = readFileSync(join(here, "fixtures/tall.html"), "utf8");

let context: BrowserContext;
let worker: Worker;
let server: Server;
let fixtureUrl: string;

interface CaptureResult {
  ok: boolean;
  filenames?: string[];
  error?: string;
}

type CaptureHook = {
  __pageSnapCapture: (
    mode: string,
    format?: string,
    pdfLayout?: string,
    theme?: string,
    zapFirst?: boolean
  ) => Promise<CaptureResult>;
};

function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function completedCount(): Promise<number> {
  return worker.evaluate(() => chrome.downloads.search({ state: "complete" }).then((d) => d.length));
}

// Playwright redirects extension downloads to GUID-named artifact files, so
// on-disk paths never carry our generated filenames; tests assert names via
// the capture result and identify files by their pixel dimensions instead.
async function newestDownloads(count: number): Promise<string[]> {
  return worker.evaluate(
    async (n) => {
      for (let i = 0; i < 150; i++) {
        const items = await chrome.downloads.search({ orderBy: ["-startTime"], state: "complete" });
        if (items.length >= n) {
          return items.slice(0, n).map((it) => it.filename);
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("Downloads did not complete in time.");
    },
    count
  );
}

async function capture(
  mode: string,
  format = "png",
  pdfLayout = "single",
  theme = "none"
): Promise<{ filenames: string[]; paths: string[] }> {
  const before = await completedCount();
  const result = await worker.evaluate(
    ([m, f, l, t]) => (globalThis as unknown as CaptureHook).__pageSnapCapture(m!, f, l, t),
    [mode, format, pdfLayout, theme]
  );
  if (!result.ok) {
    throw new Error(result.error);
  }
  const filenames = result.filenames ?? [];
  const paths = (await newestDownloads(before + filenames.length)).slice(0, filenames.length);
  return { filenames, paths };
}

test.beforeAll(async () => {
  rmSync(stateDir, { recursive: true, force: true });
  cpSync(dist, extensionDir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(extensionDir, "manifest.json"), "utf8"));
  manifest.host_permissions = ["<all_urls>"];
  writeFileSync(join(extensionDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(fixtureHtml);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Fixture server failed to bind a port.");
  }
  fixtureUrl = `http://localhost:${address.port}/`;

  context = await chromium.launchPersistentContext(join(stateDir, "profile"), {
    channel: "chromium",
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
    viewport: { width: 1280, height: 720 }
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(fixtureUrl);
});

test.afterAll(async () => {
  await context?.close();
  await new Promise((r) => server?.close(r));
});

test("viewport capture matches the visible viewport", async () => {
  const { filenames, paths } = await capture("viewport");
  expect(filenames).toHaveLength(1);
  expect(filenames[0]).toMatch(/^localhost--viewport--\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.png$/);
  const size = pngSize(paths[0]!);
  expect(size.width).toBe(1280);
  expect(size.height).toBe(720);
});

test("full-page capture spans the entire scroll height", async () => {
  const page = context.pages()[0]!;
  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(scrollHeight).toBeGreaterThan(720 * 3);

  const { filenames, paths } = await capture("full-page");
  expect(filenames[0]).toMatch(/^localhost--full-page--/);
  const size = pngSize(paths[0]!);
  expect(size.width).toBe(1280);
  expect(size.height).toBe(scrollHeight);
});

test("element capture via the in-page picker crops to the element", async () => {
  const page = context.pages()[0]!;
  await page.bringToFront();
  const before = await completedCount();

  const result = await worker.evaluate((m) => (globalThis as unknown as CaptureHook).__pageSnapCapture(m), "element");
  expect(result.ok).toBe(true);

  // #target sits at (40,120) sized 300x200; hover then click inside it.
  await page.mouse.move(190, 220);
  await page.mouse.move(191, 221);
  await page.mouse.click(191, 221);

  const [path] = await newestDownloads(before + 1);
  const size = pngSize(path!);
  expect(Math.abs(size.width - 300)).toBeLessThanOrEqual(2);
  expect(Math.abs(size.height - 200)).toBeLessThanOrEqual(2);
});

test("device capture produces one reflowed PNG per preset", async () => {
  const { filenames, paths } = await capture("device");
  expect(filenames).toHaveLength(3);
  expect(filenames.some((f) => /--device--mobile--/.test(f))).toBe(true);
  expect(filenames.some((f) => /--device--tablet--/.test(f))).toBe(true);
  expect(filenames.some((f) => /--device--desktop--/.test(f))).toBe(true);

  const sizes = paths.map(pngSize);
  const widths = sizes.map((s) => s.width).sort((a, b) => a - b);
  expect(widths).toEqual([390 * 3, 820 * 2, 1440].sort((a, b) => a - b));

  // Reflow check: 50vw bands mean content height scales with viewport width,
  // so the three captures must not be uniformly scaled copies.
  expect(new Set(sizes.map((s) => s.height)).size).toBe(3);
});

test("jpg format downloads a JPEG with a .jpg name", async () => {
  const { filenames, paths } = await capture("viewport", "jpg");
  expect(filenames[0]).toMatch(/^localhost--viewport--.*\.jpg$/);
  const bytes = readFileSync(paths[0]!);
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
});

test("pdf format wraps a full-page capture in a single-page PDF", async () => {
  const { filenames, paths } = await capture("full-page", "pdf");
  expect(filenames).toEqual([expect.stringMatching(/^localhost--full-page--.*\.pdf$/)]);
  const text = readFileSync(paths[0]!).toString("latin1");
  expect(text.startsWith("%PDF-1.4")).toBe(true);
  expect(text.split("/Subtype /Image").length - 1).toBe(1);
});

test("pdf device capture in single layout produces one three-page PDF", async () => {
  const { filenames, paths } = await capture("device", "pdf", "single");
  expect(filenames).toHaveLength(1);
  expect(filenames[0]).toMatch(/^localhost--device--\d{4}.*\.pdf$/);
  const text = readFileSync(paths[0]!).toString("latin1");
  expect(text).toContain("/Count 3");
  expect(text.split("/Subtype /Image").length - 1).toBe(3);
  expect(text).toContain("/Width 1170");
  expect(text).toContain("/Width 1640");
  expect(text).toContain("/Width 1440");
});

test("pdf device capture in multiple layout produces one PDF per size", async () => {
  const { filenames, paths } = await capture("device", "pdf", "multiple");
  expect(filenames).toHaveLength(3);
  for (const name of ["mobile", "tablet", "desktop"]) {
    expect(filenames.some((f) => f.includes(`--device--${name}--`) && f.endsWith(".pdf"))).toBe(true);
  }
  for (const path of paths) {
    const text = readFileSync(path).toString("latin1");
    expect(text).toContain("/Count 1");
    expect(text.split("/Subtype /Image").length - 1).toBe(1);
  }
});

test("light + dark theme captures a differing pair", async () => {
  const { filenames, paths } = await capture("full-page", "png", "single", "both");
  expect(filenames).toHaveLength(2);
  expect(filenames.some((f) => /--full-page--light--/.test(f))).toBe(true);
  expect(filenames.some((f) => /--full-page--dark--/.test(f))).toBe(true);

  const [a, b] = paths.map((p) => readFileSync(p));
  expect(pngSize(paths[0]!)).toEqual(pngSize(paths[1]!));
  expect(a!.equals(b!)).toBe(false); // the fixture restyles under dark scheme
});

test("zap hides picked elements for the capture and restores them after", async () => {
  const page = context.pages()[0]!;
  await page.bringToFront();
  const { paths: plainPaths } = await capture("full-page");

  const before = await completedCount();
  const result = await worker.evaluate(
    ([m]) => (globalThis as unknown as CaptureHook).__pageSnapCapture(m!, "png", "single", "none", true),
    ["full-page"]
  );
  expect(result.ok).toBe(true);

  // Zap #target (at 40,120 sized 300x200), then hit the toolbar's capture.
  await page.mouse.move(190, 220);
  await page.mouse.move(191, 221);
  await page.mouse.click(191, 221);
  await expect(page.locator("#target")).toBeHidden();
  await page.click("#page-snap-zap-capture");

  const [zappedPath] = await newestDownloads(before + 1);
  const zapped = readFileSync(zappedPath!);
  const plain = readFileSync(plainPaths[0]!);
  expect(pngSize(zappedPath!)).toEqual(pngSize(plainPaths[0]!));
  expect(zapped.equals(plain)).toBe(false); // the orange target is missing

  // The element comes back once the capture is saved.
  await expect(page.locator("#target")).toBeVisible();
});

test("popup renders all modes and persists the selection", async () => {
  const extensionId = new URL(worker.url()).hostname;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(popup.locator(".mode")).toHaveCount(4);

  // The PDF layout dropdown appears only for PDF + multi-shot captures.
  await expect(popup.locator("#pdf-layout-field")).toBeHidden();
  await popup.locator("#format").selectOption("pdf");
  await expect(popup.locator("#pdf-layout-field")).toBeHidden();
  await popup.locator('input[value="device"]').check();
  await expect(popup.locator("#pdf-layout-field")).toBeVisible();

  // Copy is for single-image captures only.
  await expect(popup.locator("#copy")).toBeDisabled();
  await popup.locator('input[value="viewport"]').check();
  await expect(popup.locator("#copy")).toBeEnabled();
  await popup.locator("#theme").selectOption("both");
  await expect(popup.locator("#copy")).toBeDisabled();
  await popup.locator("#theme").selectOption("none");
  await popup.locator("#zap").check();
  await expect(popup.locator("#copy")).toBeDisabled();
  await popup.locator("#zap").uncheck();

  // The iokig.com link is in plain view.
  await expect(popup.locator('footer a[href="https://www.iokig.com"]')).toBeVisible();

  await popup.locator('input[value="full-page"]').check();
  await expect(popup.locator("#pdf-layout-field")).toBeHidden();
  await popup.locator("#format").selectOption("jpg");
  await popup.locator("#theme").selectOption("dark");
  await popup.locator("#capture").click();

  await expect
    .poll(() =>
      worker.evaluate(() => chrome.storage.local.get(["lastMode", "lastFormat", "lastPdfLayout", "lastTheme"]))
    )
    .toEqual({ lastMode: "full-page", lastFormat: "jpg", lastPdfLayout: "single", lastTheme: "dark" });
  await popup.close();
});

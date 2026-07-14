import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: [
    { in: "src/background/background.ts", out: "background" },
    { in: "src/popup/popup.ts", out: "popup" },
    { in: "src/content/picker.ts", out: "picker" },
    { in: "src/content/zapper.ts", out: "zapper" }
  ],
  bundle: true,
  format: "esm",
  target: "chrome120",
  outdir: "dist",
  sourcemap: false,
  logLevel: "info"
};

function copyStatic() {
  mkdirSync("dist", { recursive: true });
  cpSync("manifest.json", "dist/manifest.json");
  cpSync("src/popup/popup.html", "dist/popup.html");
  cpSync("src/popup/popup.css", "dist/popup.css");
  cpSync("icon", "dist/icon", { recursive: true });
}

rmSync("dist", { recursive: true, force: true });

if (watch) {
  const ctx = await context(options);
  copyStatic();
  await ctx.watch();
} else {
  await build(options);
  copyStatic();
}

import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
await build({
  entryPoints: ["src/preload.ts"],
  outfile: "dist/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
await build({
  entryPoints: ["src/renderer/main.ts"],
  outfile: "dist/renderer.js",
  bundle: true,
  platform: "browser",
  target: "chrome130",
});
await copyFile("src/renderer/index.html", "dist/index.html");
await copyFile("assets/icon.svg", "dist/icon.svg");
await copyFile("assets/icon.png", "dist/icon.png");

await build({
  entryPoints: ["src/script/worker.ts"],
  outfile: "dist/script-worker.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
});

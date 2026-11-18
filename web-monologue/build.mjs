import { build } from "esbuild";
import { mkdir, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(root, "dist"), { recursive: true });
const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node24",
  nodePaths: [path.join(root, "node_modules")],
};
const workerOnly = process.argv.includes("--worker-only");
if (!workerOnly) {
  await build({
    ...common,
    entryPoints: [path.join(root, "src/main.ts")],
    outfile: path.join(root, "dist/main.cjs"),
  });
  await cp(path.join(root, "public"), path.join(root, "dist/public"), {
    recursive: true,
  });
}
await build({
  ...common,
  entryPoints: [path.join(root, "../src/script/worker.ts")],
  outfile: path.join(root, "dist/script-worker.cjs"),
});

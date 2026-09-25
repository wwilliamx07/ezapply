import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const common = { bundle: true, target: "chrome120", sourcemap: "linked", logLevel: "info", legalComments: "none" };
await build({
  ...common,
  entryPoints: [join(root, "src/background/index.ts")],
  outfile: join(dist, "background.js"),
  format: "esm",
});
await build({
  ...common,
  entryPoints: [join(root, "src/options/options.ts")],
  outfile: join(dist, "options.js"),
  format: "iife",
});
// Injected into Workday pages' MAIN world on demand. Keep it small and self-contained (no zod).
await build({
  ...common,
  entryPoints: [join(root, "src/adapters/workday/main.ts")],
  outfile: join(dist, "workday-main.js"),
  format: "iife",
});

const manifest = JSON.parse(await readFile(join(root, "static/manifest.json"), "utf8"));
manifest.version = pkg.version;
await writeFile(join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(join(root, "static/options.html"), join(dist, "options.html"));

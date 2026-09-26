import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const distFirefox = join(root, "dist-firefox");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

await rm(dist, { recursive: true, force: true });
await rm(distFirefox, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const common = {
  bundle: true,
  target: ["chrome120", "firefox128"],
  sourcemap: "linked",
  logLevel: "info",
  legalComments: "none",
};
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

// Firefox: the same bundles; MV3 there runs the background as an event page, not a service worker.
// The gecko id keeps the moz-extension:// UUID (which the companion pins) stable across reloads.
// 128 is the first release with scripting.executeScript({ world: "MAIN" }).
await cp(dist, distFirefox, { recursive: true });
const { minimum_chrome_version: _, background, ...rest } = manifest;
const firefoxManifest = {
  ...rest,
  background: { scripts: [background.service_worker], type: background.type },
  // Firefox's default MV3 policy includes upgrade-insecure-requests, which rewrites the companion's
  // ws://127.0.0.1 socket to wss:// (it has no TLS). Replace it, and allow connections only to loopback.
  content_security_policy: { extension_pages: "script-src 'self'; connect-src ws://127.0.0.1:*" },
  browser_specific_settings: {
    gecko: {
      id: "ezapply@ezapply.local",
      strict_min_version: "128.0",
      data_collection_permissions: { required: ["none"] },
    },
  },
};
await writeFile(
  join(distFirefox, "manifest.json"),
  `${JSON.stringify(firefoxManifest, null, 2)}
`,
);

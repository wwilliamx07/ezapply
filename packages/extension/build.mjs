import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_PERMISSIONS, SITES } from "@ezapply/protocol/sites";
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
// The side panel: the UI package's panel (React) with a transport over the background's port. Its CSS (the base
// stylesheet and the panel's) comes out beside it as panel.css.
await build({
  ...common,
  entryPoints: [join(root, "src/panel/main.tsx")],
  outfile: join(dist, "panel.js"),
  format: "esm",
  jsx: "automatic",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
// The window a form call opens to ask for a site's access (its Allow access click is the gesture the request needs).
await build({
  ...common,
  entryPoints: [join(root, "src/grant/grant.ts")],
  outfile: join(dist, "grant.js"),
  format: "iife",
});
// The site adapters, injected into application pages' MAIN world on demand. Keep them small and self-contained
// (no zod). ADAPTER_VERSION is a hash of each bundle itself, so any change reaches tabs that hold an older copy
// without anyone remembering to bump a number. The placeholder has the hash's length, keeping the source map exact.
const VERSION_PLACEHOLDER = "@ADAPTER_VER"; // 12 characters, like the hash
for (const { id: site } of SITES) {
  const adapter = await build({
    ...common,
    entryPoints: [join(root, `src/adapters/sites/${site}/main.ts`)],
    outfile: join(dist, `${site}-main.js`),
    format: "iife",
    define: { __ADAPTER_VERSION__: JSON.stringify(VERSION_PLACEHOLDER) },
    write: false,
  });
  for (const file of adapter.outputFiles) {
    let text = file.text;
    if (file.path.endsWith(".js")) {
      if (!text.includes(VERSION_PLACEHOLDER)) throw new Error(`${site} adapter build: version placeholder missing`);
      const hash = createHash("sha256").update(text).digest("hex").slice(0, VERSION_PLACEHOLDER.length);
      text = text.replaceAll(VERSION_PLACEHOLDER, hash);
    }
    await writeFile(file.path, text);
  }
}

const manifest = JSON.parse(await readFile(join(root, "static/manifest.json"), "utf8"));
manifest.version = pkg.version;
// Every site, at install: the extension tells a form site by its pages' bodies, on whatever host.
manifest.host_permissions = [...HOST_PERMISSIONS];
await writeFile(join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await cp(join(root, "static/options.html"), join(dist, "options.html"));
await cp(join(root, "static/grant.html"), join(dist, "grant.html"));
await cp(join(root, "static/panel.html"), join(dist, "panel.html"));

// Firefox: the same bundles; MV3 there runs the background as an event page, not a service worker.
// The gecko id keeps the moz-extension:// UUID (which the companion pins) stable across reloads.
// 128 is the first release with scripting.executeScript({ world: "MAIN" }).
await cp(dist, distFirefox, { recursive: true });
// Firefox has no side_panel: its sidebar_action shows the same page, opened by the toolbar button.
const { minimum_chrome_version: _, background, side_panel, permissions, ...rest } = manifest;
const firefoxManifest = {
  ...rest,
  permissions: permissions.filter((p) => p !== "sidePanel"),
  sidebar_action: { default_panel: side_panel.default_path, default_title: "ezapply", open_at_install: false },
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

import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// The companion's pages (review, onboarding), served from dist/ at /ui/ on its loopback server. Everything they
// load comes from there: no CDN and no web fonts, so nothing leaves the machine and the pages work offline.
const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// pdf.js's worker as it ships, named by its hash like the bundles, so a new version is never served from cache.
const workerSource = await readFile(join(pdfjsRoot, "build", "pdf.worker.min.mjs"));
const worker = `pdf.worker-${hash(workerSource)}.mjs`;
await writeFile(join(dist, worker), workerSource);
// What pdf.js fetches for some PDFs: the 14 standard fonts when a PDF doesn't embed them, CJK character maps,
// colour profiles, and its WebAssembly image decoders.
for (const dir of ["standard_fonts", "cmaps", "iccs", "wasm"]) {
  await cp(join(pdfjsRoot, dir), join(dist, "pdfjs", dir), { recursive: true });
}

// The tab's icon: ezapply's mark, as the pages draw it.
await writeFile(
  join(dist, "favicon.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#3b5bdb"/>' +
    '<text x="16" y="22.5" font-family="system-ui,sans-serif" font-size="19" font-weight="800" fill="#fff" text-anchor="middle">e</text></svg>\n',
);

const result = await build({
  absWorkingDir: root,
  entryPoints: {
    review: "src/review/main.tsx",
    onboard: "src/onboard/main.tsx",
    // The stylesheet alone, for the pages the companion still renders itself (GitHub setup, errors).
    base: "src/styles/base.css",
  },
  outdir: dist,
  bundle: true,
  format: "esm",
  splitting: true,
  minify: true,
  sourcemap: "linked",
  target: ["chrome120", "firefox128"],
  jsx: "automatic",
  entryNames: "[name]-[hash]",
  chunkNames: "chunk-[hash]",
  assetNames: "[name]-[hash]",
  loader: { ".svg": "file" },
  define: {
    "process.env.NODE_ENV": '"production"',
    __PDF_WORKER__: JSON.stringify(`/ui/${worker}`),
  },
  metafile: true,
  legalComments: "none",
  logLevel: "info",
});

// manifest.json: which files each page loads, read by the companion when it serves a page.
const manifest = { worker, pages: {}, base: "" };
for (const [file, out] of Object.entries(result.metafile.outputs)) {
  const name = basename(file);
  if (out.entryPoint === "src/styles/base.css") manifest.base = name;
  const page = out.entryPoint?.match(/^src\/(\w+)\/main\.tsx$/)?.[1];
  if (page) manifest.pages[page] = { js: name, css: out.cssBundle ? basename(out.cssBundle) : undefined };
}
if (!manifest.base || !manifest.pages.review || !manifest.pages.onboard) throw new Error("ui build: entries missing");
await writeFile(join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 8).toUpperCase();
}

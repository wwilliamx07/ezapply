import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize, sep } from "node:path";
import { escapeHtml } from "../util/html.js";

/** What `@ezapply/ui`'s build wrote: the files each page loads (`packages/ui/build.mjs`). */
interface UiManifest {
  worker: string;
  base: string;
  pages: Record<string, { js: string; css?: string }>;
}

type UiPage = "review" | "onboard";

/** The tab icon every page links (written by the UI build). */
const FAVICON = "/ui/favicon.svg";

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".pfb": "application/octet-stream",
  ".ttf": "font/ttf",
  ".bcmap": "application/octet-stream",
  ".icc": "application/octet-stream",
};

/**
 * The CSP of every page the UI package serves. Scripts only from /ui/ (no inline script, so no nonce);
 * `wasm-unsafe-eval` for pdf.js's image decoders; inline styles because React and pdf.js position elements with
 * them; `blob:`/`data:` images for rendered pages; workers from /ui/ (pdf.js's).
 */
const UI_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/**
 * The built UI package (`packages/ui/dist/`): served at /ui/, and the shell of each page. The manifest is read on
 * every use (a small file), so a UI built or rebuilt while a chat is open is served as it is now.
 */
export class UiAssets {
  constructor(private readonly dir: string | null = defaultUiDir()) {}

  /** The base stylesheet's URL, for the pages the companion renders itself; null when the UI isn't built. */
  baseStylesheet(): string | null {
    const m = this.read();
    return m ? `/ui/${m.base}` : null;
  }

  /** Whether the pages can be served (`ezapply doctor` reports it). */
  built(): boolean {
    return this.read() !== null;
  }

  /** GET /ui/<file>: hashed files cached for good, pdf.js's data files for a day; nothing outside dist/. */
  async handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    let rel: string;
    try {
      rel = decodeURIComponent(path.slice("/ui/".length));
    } catch {
      rel = "\0";
    }
    const dir = this.dir;
    const file = dir ? normalize(join(dir, rel)) : null;
    if (req.method !== "GET" || !dir || !file || !file.startsWith(dir + sep) || rel.includes("\0")) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      return;
    }
    const bytes = await readFile(file).catch(() => null);
    if (!bytes) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      return;
    }
    const hashed = /-[A-Z0-9]{8}\.\w+$/.test(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    res.end(bytes);
  }

  /**
   * A page's HTML: an empty root the page's script fills from its API under `base`. Without a built UI, a short
   * page saying how to build it.
   */
  page(res: ServerResponse, page: UiPage, title: string, base: string): void {
    const m = this.read();
    const entry = m?.pages[page];
    if (!m || !entry) {
      res.writeHead(503, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(
        `<!doctype html><meta charset="utf-8"><title>ezapply</title><p>ezapply's pages aren't built. Run <code>npm run build</code> in the ezapply folder, then reload.</p>`,
      );
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": UI_CSP,
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    const css = [m.base, entry.css]
      .filter((f): f is string => !!f)
      .map((f) => `<link rel="stylesheet" href="/ui/${f}">`)
      .join("");
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title><link rel="icon" href="${FAVICON}" type="image/svg+xml">${css}
<script type="module" src="/ui/${entry.js}"></script></head>
<body><div id="root" data-base="${escapeHtml(base)}"></div></body></html>`);
  }

  private read(): UiManifest | null {
    if (!this.dir) return null;
    try {
      return JSON.parse(readFileSync(join(this.dir, "manifest.json"), "utf8")) as UiManifest;
    } catch {
      return null;
    }
  }
}

/** packages/ui/dist, found through the workspace's link to the package. */
function defaultUiDir(): string | null {
  try {
    return join(dirname(createRequire(import.meta.url).resolve("@ezapply/ui/package.json")), "dist");
  } catch {
    return null;
  }
}

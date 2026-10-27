import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, sep } from "node:path";
import { build } from "esbuild";
import type { Fake } from "./fakes.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const UI_DIST = join(ROOT, "packages", "ui", "dist");
/** Where the panel's page is built: the panel the extension bundles, with a transport to this server. */
const PANEL_BUILD = join(ROOT, ".fuzz", "build");

/** The companion's policy for its pages (`companion/src/ui/assets.ts`), so the fuzz catches what it would block. */
const CSP = [
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

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
  ".wasm": "application/wasm",
  ".pfb": "application/octet-stream",
  ".bcmap": "application/octet-stream",
  ".icc": "application/octet-stream",
  ".ttf": "font/ttf",
};

/**
 * The fake companion on a loopback port: the UI package's built pages and files under /ui/, the panel's page, and
 * each run's fake under /run/<id>/. A run is one fresh page load: its own fake, so runs never share state and can go
 * side by side.
 */
export class FuzzServer {
  private server: Server | null = null;
  private readonly runs = new Map<string, { fake: Fake; streams: Set<ServerResponse> }>();
  private next = 0;
  origin = "";

  async start(): Promise<void> {
    if (!existsSync(join(UI_DIST, "manifest.json"))) throw new Error("The UI isn't built: run npm run build first.");
    await buildPanel();
    this.server = createServer((req, res) => {
      void this.serve(req, res).catch((err) => {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(String(err));
      });
    });
    await new Promise<void>((ok) => this.server?.listen(0, "127.0.0.1", ok));
    this.origin = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    for (const run of this.runs.values()) for (const s of run.streams) s.end();
    await new Promise<void>((ok) => (this.server ? this.server.close(() => ok()) : ok()));
  }

  /** A new run of a fake: the address of its page. */
  open(fake: Fake): { url: string; close(): void } {
    const id = `r${++this.next}`;
    const run = { fake, streams: new Set<ServerResponse>() };
    this.runs.set(id, run);
    const stop = fake.listen((event, data) => {
      for (const s of run.streams) s.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    });
    const path = fake.page === "review" ? "review/rev-0000" : fake.page;
    return {
      url: `${this.origin}/run/${id}/${path}`,
      close: () => {
        stop();
        for (const s of run.streams) s.end();
        this.runs.delete(id);
      },
    };
  }

  private async serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", this.origin);
    if (url.pathname.startsWith("/ui/")) return file(res, UI_DIST, url.pathname.slice(4));
    if (url.pathname.startsWith("/fuzz/build/")) return file(res, PANEL_BUILD, url.pathname.slice(12));
    // Where the setup page sends GitHub's tab: a page of nothing, standing in for GitHub.
    if (url.pathname === "/fuzz/elsewhere")
      return html(res, "<!doctype html><title>Elsewhere</title><p>Elsewhere.</p>");
    if (url.pathname === "/favicon.ico") return void res.writeHead(204).end();

    const m = /^\/run\/(r\d+)\/(panel|onboard|review\/[\w-]+)(?:\/(.*))?$/.exec(url.pathname);
    const run = m && this.runs.get(m[1] as string);
    if (!m || !run) return void res.writeHead(404).end();
    const base = `/run/${m[1]}/${m[2]}`;
    const rest = m[3] ?? "";
    if (!rest && req.method === "GET") return html(res, page(run.fake.page, base));
    if (rest === "events" || rest === "panel/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store" });
      res.write("retry: 2000\n\n");
      run.streams.add(res);
      req.on("close", () => run.streams.delete(res));
      return;
    }
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const reply = run.fake.handle({
      method: req.method ?? "GET",
      path: rest,
      query: url.searchParams,
      body: Buffer.concat(chunks),
      origin: this.origin,
    });
    if (!reply) return void res.writeHead(404).end();
    if (reply.json !== undefined) {
      res.writeHead(reply.status, { "Content-Type": "application/json", ...reply.headers });
      res.end(JSON.stringify(reply.json));
      return;
    }
    res.writeHead(reply.status, { ...(reply.type ? { "Content-Type": reply.type } : {}), ...reply.headers });
    res.end(reply.body);
  }
}

/** A page's HTML as the companion writes it (`UiAssets.page`); the panel's as the extension's panel.html. */
function page(which: Fake["page"], base: string): string {
  if (which === "panel") {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>ezapply</title>
<link rel="stylesheet" href="/fuzz/build/panel.css"><script type="module" src="/fuzz/build/panel.js"></script></head>
<body><div id="root" data-run="${base}"></div></body></html>`;
  }
  const manifest = JSON.parse(readFileSync(join(UI_DIST, "manifest.json"), "utf8")) as {
    base: string;
    pages: Record<string, { js: string; css?: string }>;
  };
  const entry = manifest.pages[which];
  if (!entry) throw new Error(`The UI build has no ${which} page.`);
  const css = [manifest.base, entry.css]
    .filter(Boolean)
    .map((c) => `<link rel="stylesheet" href="/ui/${c}">`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<title>ezapply</title><link rel="icon" href="/ui/favicon.svg" type="image/svg+xml">${css}
<script type="module" src="/ui/${entry.js}"></script></head>
<body><div id="root" data-base="${base}"></div></body></html>`;
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": CSP,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function file(res: ServerResponse, dir: string, rel: string): void {
  const path = normalize(join(dir, decodeURIComponent(rel)));
  if (!path.startsWith(dir + sep) || !existsSync(path)) return void res.writeHead(404).end();
  res.writeHead(200, {
    "Content-Type": TYPES[extname(path)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(readFileSync(path));
}

/** The panel's page: `panel/main.tsx` bundled as the extension bundles its own (base and panel stylesheets beside it). */
async function buildPanel(): Promise<void> {
  await build({
    absWorkingDir: ROOT,
    entryPoints: { panel: join(import.meta.dirname, "..", "panel", "main.tsx") },
    outdir: PANEL_BUILD,
    bundle: true,
    format: "esm",
    target: ["chrome120"],
    jsx: "automatic",
    sourcemap: "linked",
    define: { "process.env.NODE_ENV": '"development"' },
    logLevel: "warning",
  });
}

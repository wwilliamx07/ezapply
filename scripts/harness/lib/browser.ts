import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERIC, siteOfUrl } from "@ezapply/sites";
import { type BrowserContext, chromium, type Frame, type Page, type Request } from "playwright";
import type { RawExchange } from "../clone/normalise.ts";
import type { StandIn } from "../standin/engine.ts";

const EXTENSION_DIST = join(import.meta.dirname, "..", "..", "..", "packages", "extension", "dist");

/**
 * The browsers tried, in order: Playwright's Chromium (`npx playwright install chromium`), then the installed Edge and
 * Chrome, for a machine whose policy won't run a downloaded browser. The harness injects the adapter itself, so any
 * Chromium will do.
 */
const CHANNELS = ["chromium", "msedge", "chrome"] as const;

/** Whether any of them is installed: the browser tests skip without one. */
export function hasBrowser(): boolean {
  const installed = (p: string | undefined) => !!p && existsSync(p);
  const local = process.env.LOCALAPPDATA ?? "";
  return (
    installed(safe(() => chromium.executablePath())) ||
    [
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      `${local}/Google/Chrome/Application/chrome.exe`,
      "/Applications/Microsoft Edge.app",
      "/Applications/Google Chrome.app",
      "/usr/bin/microsoft-edge",
      "/usr/bin/google-chrome",
    ].some(installed)
  );
}

const safe = <T>(f: () => T): T | undefined => {
  try {
    return f();
  } catch {
    return undefined;
  }
};

/**
 * A browser in a profile of its own (a sign-in made there lasts across clones of the site), with service workers
 * blocked so every request goes through the recorder or the stand-in.
 */
export async function launch(profile: string, headed: boolean): Promise<BrowserContext> {
  let last: unknown;
  for (const channel of CHANNELS) {
    try {
      return await chromium.launchPersistentContext(profile, {
        channel,
        headless: !headed,
        serviceWorkers: "block",
        viewport: { width: 1280, height: 900 },
        locale: "en-US",
        timezoneId: "UTC",
      });
    } catch (err) {
      last = err;
    }
  }
  throw last;
}

/** The registry site a URL is on, else the generic adapter (an employer's own form). */
export function siteFor(url: string): { id: string; isUrl: (u: string) => boolean } {
  // The generic adapter reads the page itself, never a frame in it.
  return siteOfUrl(url) ?? { id: GENERIC.id, isUrl: () => false };
}

/**
 * A site's adapter in a page, called as the extension calls it: its built bundle injected into the page's main world
 * (again before each call, which does nothing while the page holds the same build), then the method called with
 * debug mode's trace asked for. Calls go to the frame on the site's own URL (an application embedded in a careers
 * page), else the page.
 */
export class Adapter {
  private readonly bundle: string;
  readonly global: string;
  /** Every call's debug trace, in order. */
  readonly traces: { method: string; args: unknown[]; trace: unknown }[] = [];

  readonly page: Page;
  readonly site: { id: string; isUrl: (u: string) => boolean };

  constructor(page: Page, site: { id: string; isUrl: (u: string) => boolean }) {
    this.page = page;
    this.site = site;
    const file = join(EXTENSION_DIST, `${site.id}-main.js`);
    if (!existsSync(file)) throw new Error(`No adapter bundle at ${file}: run npm run build first.`);
    this.bundle = readFileSync(file, "utf8");
    this.global = `__ezapply_${site.id}`;
  }

  frame(): Frame {
    return (
      this.page.frames().find((f) => f !== this.page.mainFrame() && this.site.isUrl(f.url())) ?? this.page.mainFrame()
    );
  }

  async call<T>(method: string, ...args: unknown[]): Promise<T> {
    const frame = this.frame();
    await frame.evaluate(this.bundle);
    const out = (await frame.evaluate(
      async ([g, m, a]) => {
        const api = (window as unknown as Record<string, Record<string, (...x: unknown[]) => unknown>>)[g as string];
        if (!api) return { __error: "adapter not loaded" };
        try {
          api.setTiming?.(null);
          api.setDebug?.({ failures: true });
          const ok = await api[m as string]?.(...(a as unknown[]));
          return { __ok: ok, __debug: api.takeDebug?.() };
        } catch (err) {
          return { __error: (err as Error).message, __debug: api.takeDebug?.() };
        }
      },
      [this.global, method, args] as const,
    )) as { __ok?: T; __error?: string; __debug?: unknown };
    this.traces.push({ method, args, trace: out.__debug });
    if (out.__error) throw new Error(`${method}: ${out.__error}`);
    return out.__ok as T;
  }
}

/**
 * Records every request the browser sends and its answer, tagged with what the explorer was doing when it was
 * sent. Kept in memory: `normalise` decides what's written.
 */
export class Recorder {
  action = "load";
  pass: RawExchange["pass"] = "explore";
  readonly raw: RawExchange[] = [];
  private readonly tags = new WeakMap<Request, { action: string; pass: RawExchange["pass"] }>();
  private readonly pending = new Set<Promise<void>>();

  attach(context: BrowserContext): void {
    context.on("request", (r) => this.tags.set(r, { action: this.action, pass: this.pass }));
    context.on("requestfinished", (r) => {
      const p = this.take(r).finally(() => this.pending.delete(p));
      this.pending.add(p);
    });
  }

  /** Waits for the bodies still being read. */
  async settle(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private async take(r: Request): Promise<void> {
    const res = await r.response();
    if (!res) return;
    let body: Buffer | undefined;
    try {
      body = res.status() >= 300 && res.status() < 400 ? undefined : await res.body();
    } catch {
      // a body the browser no longer holds (a navigation away)
    }
    const t = r.timing();
    const tag = this.tags.get(r) ?? { action: this.action, pass: this.pass };
    this.raw.push({
      method: r.method(),
      url: r.url(),
      resourceType: r.resourceType(),
      reqHeaders: await r.allHeaders(),
      ...(r.postDataBuffer() ? { reqBody: r.postDataBuffer() as Buffer } : {}),
      status: res.status(),
      resHeaders: await res.allHeaders(),
      ...(body ? { body } : {}),
      ...(t.requestStart >= 0 && t.responseStart >= t.requestStart && t.responseEnd >= t.responseStart
        ? { timing: { wait: t.responseStart - t.requestStart, receive: t.responseEnd - t.responseStart } }
        : {}),
      ...tag,
    });
  }
}

/** Every request in the context answered by the stand-in, or failed when it has no answer: nothing reaches a network. */
export async function serve(context: BrowserContext, standIn: StandIn): Promise<void> {
  await context.route("**/*", async (route) => {
    const r = route.request();
    if (!/^https?:/.test(r.url())) return route.continue();
    const res = standIn.handle({
      method: r.method(),
      url: r.url(),
      headers: r.headers(),
      ...(r.postDataBuffer() ? { body: r.postDataBuffer() as Buffer } : {}),
    });
    if (!res) return route.abort("failed");
    if (res.delayMs) await new Promise((ok) => setTimeout(ok, res.delayMs));
    await route.fulfill({ status: res.status, headers: res.headers, body: res.body }).catch(() => {});
  });
}

/**
 * A wait for the context's network to go quiet: no request in flight for `idleMs`, at most `maxMs`. The explorer
 * waits for it after each call, so the requests a call set off are tagged with it.
 */
export function quietness(context: BrowserContext): (idleMs?: number, maxMs?: number) => Promise<void> {
  let inFlight = 0;
  let last = Date.now();
  const done = () => {
    inFlight = Math.max(0, inFlight - 1);
    last = Date.now();
  };
  context.on("request", () => {
    inFlight++;
    last = Date.now();
  });
  context.on("requestfinished", done);
  context.on("requestfailed", done);
  return async (idleMs = 300, maxMs = 8000) => {
    const end = Date.now() + maxMs;
    while (Date.now() < end && (inFlight > 0 || Date.now() - last < idleMs))
      await new Promise((ok) => setTimeout(ok, 50));
  };
}

/** A bot challenge on screen (a captcha's challenge frame, a vendor's interstitial): the harness never works around one. */
export async function challenged(page: Page): Promise<string | undefined> {
  const re =
    /challenges\.cloudflare\.com|captcha-delivery|hcaptcha\.com\/.*challenge|recaptcha\/(api2|enterprise)\/bframe|px-captcha|perimeterx/i;
  for (const f of page.frames()) {
    if (!re.test(f.url())) continue;
    const el = await f.frameElement().catch(() => null);
    if (el && (await el.isVisible().catch(() => false))) return f.url();
  }
  return undefined;
}

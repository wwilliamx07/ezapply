import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { type BrowserInfo, type BrowserName, ErrorCode, EzError, isBrowserName } from "@ezapply/protocol";
import { findBrowser } from "./browser.js";

/**
 * Opens something for the user. Replaceable in tests, where nothing may pop up. Each call resolves to what
 * it was opened with: a browser name (`chrome`, `firefox`…) or `default` (the system's own choice).
 */
export interface Opener {
  /** A file: in the user's browser when a browser shows that kind of file, else its default application. */
  file(path: string): Promise<string>;
  /** One of the companion's own pages (`http://127.0.0.1:<port>/…`), in the user's browser. */
  url(url: string): Promise<string>;
}

/**
 * Files a browser displays, and nothing that can run script: `.html` (a posting's raw capture) and `.svg`
 * go to their default application instead of into a browser tab with the user's sessions.
 */
const BROWSER_FILES = new Set([".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".txt"]);

export interface DesktopOpenerOptions {
  /** The browser the extension runs in, as last reported (`ExtensionBridge.browser()`). */
  browser?: () => BrowserInfo | undefined;
  /** Test hooks. */
  find?: (name: BrowserName) => Promise<string[] | null>;
  launch?: (command: string, args: string[]) => Promise<void>;
}

/**
 * Opens pages and files in the browser the user applies in: the one the extension reported, where their
 * sign-ins and the extension are. The system default browser may be another one. The companion starts that
 * browser's program with the URL itself (the extension couldn't open local files without the user granting
 * it file access). When no browser was reported, or its program isn't found or won't start, the OS opener
 * decides, as before.
 */
export function createDesktopOpener(opts: DesktopOpenerOptions = {}): Opener {
  const find = opts.find ?? ((name: BrowserName) => findBrowser(name));
  const launch = opts.launch ?? launchDetached;
  const cache = new Map<BrowserName, string[]>();
  const system = async (target: string) => {
    await launch(OS_OPENER, [target]);
    return "default";
  };
  const inBrowser = async (target: string): Promise<string | null> => {
    const name = opts.browser?.()?.name;
    if (!name || !isBrowserName(name)) return null;
    let command = cache.get(name) ?? null;
    if (!command) {
      command = await find(name).catch(() => null);
      if (!command) return null;
      cache.set(name, command); // hits only: a browser installed later is found on the next call
    }
    const [program, ...before] = command as [string, ...string[]];
    try {
      await launch(program, [...before, target]);
      return name;
    } catch {
      cache.delete(name);
      return null;
    }
  };
  return {
    async file(path) {
      await stat(path).catch(() => {
        throw new EzError(ErrorCode.NotFound, `File not found: ${path}`);
      });
      // A file:// URL never starts with "-", so the browser can't read it as a command-line flag.
      if (BROWSER_FILES.has(extname(path).toLowerCase())) {
        const via = await inBrowser(pathToFileURL(path).href);
        if (via) return via;
      }
      return system(path);
    },
    async url(url) {
      assertLocalUrl(url);
      return (await inBrowser(url)) ?? system(url);
    },
  };
}

const LABELS: Record<BrowserName, string> = {
  chrome: "Chrome",
  edge: "Edge",
  brave: "Brave",
  opera: "Opera",
  vivaldi: "Vivaldi",
  chromium: "Chromium",
  firefox: "Firefox",
};

/** A browser's name for the user ("Chrome"); "the browser" for an Opener's `default` (the system's choice). */
export function browserLabel(name: string): string {
  return isBrowserName(name) ? LABELS[name] : name === "default" ? "the browser" : name;
}

/** Only the companion's loopback pages may be opened: nothing Claude or a page supplies reaches a browser. */
export function assertLocalUrl(url: string): void {
  let u: URL | null = null;
  try {
    u = new URL(url);
  } catch {
    // reported below
  }
  if (u?.protocol !== "http:" || u.hostname !== "127.0.0.1" || !u.port || u.username || u.password) {
    throw new EzError(ErrorCode.BadRequest, `Refusing to open ${url}: only http://127.0.0.1:<port>/ pages are opened.`);
  }
}

// explorer.exe hands a file or URL to its registered program without a shell parsing it.
const OS_OPENER = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";

/**
 * Start a program without a shell and without waiting for it: it may be a long-lived viewer or browser,
 * which must outlive this call (and a timeout must never kill it). Resolves once it started; rejects when it
 * couldn't (e.g. no xdg-open on a headless Linux).
 */
function launchDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

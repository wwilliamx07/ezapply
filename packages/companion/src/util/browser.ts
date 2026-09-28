import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { BrowserName } from "@ezapply/protocol";
import { run, which } from "./proc.js";

interface BrowserSpec {
  /** Windows: the App Paths name (the registry key installers write), when the browser registers one. */
  appPath?: string;
  /** Windows: install locations under Program Files, Program Files (x86) and Local AppData. */
  winPaths: string[];
  /** macOS: the application bundle's name. */
  macApp: string;
  /** Linux and other Unixes: commands on PATH. */
  bins: string[];
}

const SPECS: Record<BrowserName, BrowserSpec> = {
  chrome: {
    appPath: "chrome.exe",
    winPaths: ["Google\\Chrome\\Application\\chrome.exe"],
    macApp: "Google Chrome",
    bins: ["google-chrome", "google-chrome-stable"],
  },
  edge: {
    appPath: "msedge.exe",
    winPaths: ["Microsoft\\Edge\\Application\\msedge.exe"],
    macApp: "Microsoft Edge",
    bins: ["microsoft-edge", "microsoft-edge-stable"],
  },
  brave: {
    appPath: "brave.exe",
    winPaths: ["BraveSoftware\\Brave-Browser\\Application\\brave.exe"],
    macApp: "Brave Browser",
    bins: ["brave-browser", "brave"],
  },
  opera: {
    appPath: "opera.exe",
    winPaths: ["Programs\\Opera\\opera.exe", "Programs\\Opera\\launcher.exe"],
    macApp: "Opera",
    bins: ["opera"],
  },
  vivaldi: {
    appPath: "vivaldi.exe",
    winPaths: ["Vivaldi\\Application\\vivaldi.exe"],
    macApp: "Vivaldi",
    bins: ["vivaldi", "vivaldi-stable"],
  },
  // No App Paths entry: Chromium's program is also chrome.exe, and that key belongs to Google Chrome.
  chromium: {
    winPaths: ["Chromium\\Application\\chrome.exe"],
    macApp: "Chromium",
    bins: ["chromium", "chromium-browser"],
  },
  firefox: {
    appPath: "firefox.exe",
    winPaths: ["Mozilla Firefox\\firefox.exe"],
    macApp: "Firefox",
    bins: ["firefox"],
  },
};

export interface FindBrowserDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  exists: (path: string) => boolean;
  which: (bin: string) => string | null;
  /** The default value of a registry key, or null. */
  registryDefault: (key: string) => Promise<string | null>;
}

const defaultDeps = (): FindBrowserDeps => ({
  platform: process.platform,
  env: process.env,
  home: homedir(),
  exists: existsSync,
  which,
  registryDefault,
});

/**
 * The command that opens a URL in `name` on this machine: the program and the arguments that go before the
 * URL, or null when the browser isn't found. Windows: the App Paths registry entry (per user, then per
 * machine), then the usual install folders. macOS: `open -a <bundle>`. Elsewhere: the browser's command on
 * PATH. Handing the running browser a URL this way opens it as a new tab in its open window.
 */
export async function findBrowser(name: BrowserName, deps: FindBrowserDeps = defaultDeps()): Promise<string[] | null> {
  const spec = SPECS[name];
  if (deps.platform === "win32") {
    if (spec.appPath) {
      for (const hive of ["HKCU", "HKLM"]) {
        const value = await deps.registryDefault(
          `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${spec.appPath}`,
        );
        // REG_EXPAND_SZ values may hold %VARIABLES%.
        const exe = value?.replace(/%([^%]+)%/g, (all, v: string) => deps.env[v] ?? all);
        if (exe && deps.exists(exe)) return [exe];
      }
    }
    const roots = [deps.env.ProgramFiles, deps.env["ProgramFiles(x86)"], deps.env.LOCALAPPDATA].filter(
      (r): r is string => Boolean(r),
    );
    for (const root of roots) {
      for (const rel of spec.winPaths) {
        const exe = join(root, rel);
        if (deps.exists(exe)) return [exe];
      }
    }
    return null;
  }
  if (deps.platform === "darwin") {
    for (const dir of ["/Applications", join(deps.home, "Applications")]) {
      const app = join(dir, `${spec.macApp}.app`);
      if (deps.exists(app)) return ["open", "-a", app];
    }
    return null;
  }
  for (const bin of spec.bins) {
    const path = deps.which(bin);
    if (path) return [path];
  }
  return null;
}

/** `reg query <key> /ve`: the key's default value, without quotes. */
async function registryDefault(key: string): Promise<string | null> {
  const r = await run("reg", ["query", key, "/ve"], { timeoutMs: 5000 }).catch(() => null);
  if (r?.exitCode !== 0) return null;
  return parseRegistryDefault(r.stdout);
}

export function parseRegistryDefault(stdout: string): string | null {
  const m = stdout.match(/REG_(?:EXPAND_)?SZ[ \t]+(.+?)[ \t]*$/m);
  return m?.[1] ? m[1].replace(/^"(.*)"$/, "$1") : null;
}

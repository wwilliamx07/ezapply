import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { BrowserInfo } from "@ezapply/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAppConfig, updateAppConfig } from "../src/config/app.js";
import { WorkspaceConfig } from "../src/config/workspace.js";
import { rotateLog } from "../src/logger.js";
import { type FindBrowserDeps, findBrowser, parseRegistryDefault } from "../src/util/browser.js";
import { KeyedQueue } from "../src/util/keyed-queue.js";
import { assertLocalUrl, browserLabel, createDesktopOpener } from "../src/util/open.js";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ezapply-util-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("KeyedQueue", () => {
  it("runs one task at a time per key, in order, and keys independently", async () => {
    const q = new KeyedQueue();
    const events: string[] = [];
    const task = (name: string, ms: number) => async () => {
      events.push(`${name}:start`);
      await new Promise((r) => setTimeout(r, ms));
      events.push(`${name}:end`);
      return name;
    };
    const results = await Promise.all([
      q.run("a", task("a1", 30)),
      q.run("a", task("a2", 1)),
      q.run("b", task("b1", 1)),
    ]);
    expect(results).toEqual(["a1", "a2", "b1"]);
    expect(events.indexOf("a2:start")).toBeGreaterThan(events.indexOf("a1:end"));
    expect(events.indexOf("b1:start")).toBeLessThan(events.indexOf("a1:end"));
  });

  it("keeps going after a task fails", async () => {
    const q = new KeyedQueue();
    await expect(q.run("k", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await q.run("k", async () => "next")).toBe("next");
  });
});

describe("rotateLog", () => {
  it("keeps three files once the log passes the limit, dropping the oldest", async () => {
    const dir = join(root, "logs");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dir);
    const log = join(dir, "companion.log");
    await writeFile(log, "small");
    expect(rotateLog(log, 10, 3)).toBe(false);

    for (const gen of ["one", "two", "three"]) {
      await writeFile(log, `${gen} ${"x".repeat(20)}`);
      expect(rotateLog(log, 10, 3)).toBe(true);
    }
    expect((await readdir(dir)).sort()).toEqual(["companion.log.1", "companion.log.2"]);
    expect(await readFile(`${log}.1`, "utf8")).toMatch(/^three/);
    expect(await readFile(`${log}.2`, "utf8")).toMatch(/^two/);
  });
});

describe("assertLocalUrl", () => {
  it("lets only the companion's own loopback pages through to the OS opener", () => {
    expect(() => assertLocalUrl("http://127.0.0.1:17373/github/start?nonce=x")).not.toThrow();
    for (const bad of [
      "https://127.0.0.1:17373/x",
      "http://localhost:17373/x",
      "http://127.0.0.1/x",
      "http://evil.example/x",
      "file:///etc/passwd",
      "http://user:pw@127.0.0.1:1/x",
      "C:\\Windows\\notepad.exe",
    ]) {
      expect(() => assertLocalUrl(bad), bad).toThrow(/only http:\/\/127\.0\.0\.1/);
    }
  });
});

describe("findBrowser", () => {
  const deps = (over: Partial<FindBrowserDeps>): FindBrowserDeps => ({
    platform: "win32",
    env: { ProgramFiles: "C:\\PF", "ProgramFiles(x86)": "C:\\PF86", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" },
    home: "/Users/u",
    exists: () => false,
    which: () => null,
    registryDefault: async () => null,
    ...over,
  });

  it("on Windows uses the App Paths entry (expanding variables), then the install folders", async () => {
    const keys: string[] = [];
    const registry = async (key: string) => {
      keys.push(key);
      return key.startsWith("HKLM") ? "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" : null;
    };
    const chrome = join("C:\\PF", "Google\\Chrome\\Application\\chrome.exe");
    expect(await findBrowser("chrome", deps({ registryDefault: registry, exists: (p) => p === chrome }))).toEqual([
      chrome,
    ]);
    expect(keys).toEqual([
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
      "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe",
    ]);

    const edge = join("C:\\PF86", "Microsoft\\Edge\\Application\\msedge.exe");
    expect(await findBrowser("edge", deps({ exists: (p) => p === edge }))).toEqual([edge]);

    // Chromium's program is chrome.exe too, so the App Paths key (Google Chrome's) isn't asked.
    const asked: string[] = [];
    const chromium = join("C:\\Users\\u\\AppData\\Local", "Chromium\\Application\\chrome.exe");
    const found = await findBrowser(
      "chromium",
      deps({
        registryDefault: async (k) => {
          asked.push(k);
          return chrome;
        },
        exists: (p) => p === chromium || p === chrome,
      }),
    );
    expect(found).toEqual([chromium]);
    expect(asked).toEqual([]);
    expect(await findBrowser("firefox", deps({}))).toBeNull();
  });

  it("on macOS opens the application bundle, and elsewhere runs the command on PATH", async () => {
    const app = join("/Users/u/Applications", "Firefox.app");
    expect(await findBrowser("firefox", deps({ platform: "darwin", exists: (p) => p === app }))).toEqual([
      "open",
      "-a",
      app,
    ]);
    expect(await findBrowser("brave", deps({ platform: "darwin" }))).toBeNull();
    expect(
      await findBrowser(
        "chrome",
        deps({
          platform: "linux",
          which: (b) => (b === "google-chrome-stable" ? "/usr/bin/google-chrome-stable" : null),
        }),
      ),
    ).toEqual(["/usr/bin/google-chrome-stable"]);
  });

  it("reads the default value from reg query output", () => {
    const out =
      "\r\nHKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe\r\n" +
      '    (Default)    REG_SZ    "C:\\Program Files\\Mozilla Firefox\\firefox.exe"\r\n\r\n';
    expect(parseRegistryDefault(out)).toBe("C:\\Program Files\\Mozilla Firefox\\firefox.exe");
    expect(parseRegistryDefault("    (Default)    REG_EXPAND_SZ    %X%\\b.exe\r\n")).toBe("%X%\\b.exe");
    expect(parseRegistryDefault("ERROR: The system was unable to find the specified registry key")).toBeNull();
  });
});

describe("createDesktopOpener", () => {
  function opener(browser: BrowserInfo | undefined, found: string[] | null = ["/bin/chrome"], fails = false) {
    const launched: string[][] = [];
    const o = createDesktopOpener({
      browser: () => browser,
      find: async () => found,
      launch: async (command, args) => {
        if (fails && command === found?.[0]) throw new Error("won't start");
        launched.push([command, ...args]);
      },
    });
    return { o, launched };
  }
  const page = "http://127.0.0.1:17373/review/r1?t=x";

  it("opens pages and PDFs in the browser the extension reported", async () => {
    const pdf = join(root, "resume.pdf");
    await writeFile(pdf, "%PDF-1.7");
    const { o, launched } = opener({ name: "chrome" });
    expect(await o.url(page)).toBe("chrome");
    expect(await o.file(pdf)).toBe("chrome");
    expect(launched).toEqual([
      ["/bin/chrome", page],
      ["/bin/chrome", pathToFileURL(pdf).href],
    ]);
    expect(pathToFileURL(pdf).href.startsWith("file:")).toBe(true);
  });

  it("leaves it to the system without a reported browser, a found program, or a start, and for other files", async () => {
    const html = join(root, "raw.html");
    await writeFile(html, "<p>posting</p>");
    for (const { o, launched } of [
      opener(undefined),
      opener({ name: "arc" }),
      opener({ name: "firefox" }, null),
      opener({ name: "chrome" }, ["/bin/chrome"], true),
    ]) {
      expect(await o.url(page)).toBe("default");
      expect(launched).toHaveLength(1);
      expect(launched[0]?.slice(1)).toEqual([page]);
      expect(launched[0]?.[0]).not.toBe("/bin/chrome");
    }
    const { o, launched } = opener({ name: "chrome" });
    expect(await o.file(html)).toBe("default"); // may run script: never into a tab with the user's sessions
    expect(launched[0]?.slice(1)).toEqual([html]);
    await expect(o.url("https://evil.example/")).rejects.toMatchObject({ code: "bad_request" });
    expect(launched).toHaveLength(1);
  });

  it("names what it opened with for the user", () => {
    expect(browserLabel("edge")).toBe("Edge");
    expect(browserLabel("default")).toBe("the browser");
  });
});

describe("updateAppConfig", () => {
  it("changes only what it's asked to, on the file as it is now", async () => {
    const path = join(root, "config.json");
    const base = {
      schemaVersion: 1 as const,
      host: "127.0.0.1" as const,
      port: 17373,
      mcpToken: "t".repeat(43),
      pairingToken: "ABCD-EFGH-JKLM-NPQR",
      workspace: join(root, "ws"),
    };
    await writeFile(path, JSON.stringify({ ...base, port: 18000 }));
    const next = await updateAppConfig((c) => ({ ...c, pairedExtensionId: "a".repeat(32) }), base, path);
    expect(next).toMatchObject({ port: 18000, pairedExtensionId: "a".repeat(32) });
    expect(JSON.parse(await readFile(path, "utf8")).port).toBe(18000);
  });

  it("moves an earlier build's daemon.json to config.json, keeping the pairing and dropping the idle timeout", async () => {
    const dir = await mkdtemp(join(root, "legacy-"));
    const old = {
      schemaVersion: 1,
      host: "127.0.0.1",
      port: 17373,
      mcpToken: "t".repeat(43),
      pairingToken: "ABCD-EFGH-JKLM-NPQR",
      pairedExtensionId: "a".repeat(32),
      workspace: join(root, "ws"),
      idleTimeoutMinutes: 15,
    };
    await writeFile(join(dir, "daemon.json"), JSON.stringify(old));
    const config = await loadAppConfig(join(dir, "config.json"));
    expect(config).toMatchObject({ pairedExtensionId: "a".repeat(32), port: 17373 });
    expect(config).not.toHaveProperty("idleTimeoutMinutes");
    expect((await readdir(dir)).sort()).toEqual(["config.json"]);
    expect(await loadAppConfig(join(dir, "missing", "config.json"))).toBeNull();
  });
});

describe("WorkspaceConfig", () => {
  it("brings the browser to the front by default, and falls back to that on a bad value", () => {
    expect(WorkspaceConfig.parse({ schemaVersion: 1 }).forms).toEqual({ focusBrowser: "on" });
    expect(WorkspaceConfig.parse({ schemaVersion: 1, forms: { focusBrowser: "off" } }).forms.focusBrowser).toBe("off");
    const bad = WorkspaceConfig.parse({ schemaVersion: 1, forms: { focusBrowser: true } });
    expect(bad.forms).toEqual({ focusBrowser: "on" });
  });
});

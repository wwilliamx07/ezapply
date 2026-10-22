import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OnboardState } from "@ezapply/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/github/secrets.js";
import { createLogger } from "../src/logger.js";
import { type CompanionHandle, startCompanion } from "../src/main.js";
import { texInstallPlan } from "../src/util/install-tex.js";
import { waitFor } from "../src/util/wait.js";

// The install itself is the system's: the page's action is tested against a stand-in.
const { installTex } = vi.hoisted(() => ({ installTex: vi.fn() }));
vi.mock("../src/util/install-tex.js", async (orig) => ({
  ...(await orig<typeof import("../src/util/install-tex.js")>()),
  installTex,
}));

describe("how TeX is installed", () => {
  const has =
    (...bins: string[]) =>
    (bin: string) =>
      bins.includes(bin);

  it("runs winget on Windows, then lets MiKTeX fetch packages without asking", () => {
    expect(texInstallPlan("win32", has("winget"))).toMatchObject({
      how: "run",
      program: "winget",
      args: expect.arrayContaining(["MiKTeX.MiKTeX"]),
      after: { program: "initexmf", args: ["--set-config-value=[MPM]AutoInstall=1"] },
    });
    expect(texInstallPlan("win32", has())).toBeNull();
  });

  it("opens Terminal on a Mac with Homebrew, for the password the installer asks", () => {
    expect(texInstallPlan("darwin", has("brew"))).toEqual({
      how: "terminal",
      command: "brew install --cask mactex-no-gui",
    });
    expect(texInstallPlan("darwin", has())).toBeNull();
  });

  it("asks through polkit on Linux with apt, and leaves other systems to the command shown", () => {
    expect(texInstallPlan("linux", has("pkexec", "apt-get"))).toEqual({
      how: "run",
      program: "pkexec",
      args: ["apt-get", "install", "-y", "texlive-xetex", "latexmk"],
    });
    expect(texInstallPlan("linux", has("apt-get"))).toBeNull();
    expect(texInstallPlan("linux", has("pkexec", "dnf"))).toBeNull();
  });
});

describe("the setup page's Install it", () => {
  let dir: string;
  let handle: CompanionHandle;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ezapply-install-tex-"));
    await mkdir(join(dir, "ws"), { recursive: true });
    handle = await startCompanion({
      config: {
        schemaVersion: 1,
        host: "127.0.0.1",
        port: 0,
        mcpToken: "t".repeat(43),
        pairingToken: "ABCD-EFGH-JKLM-NPQR",
        workspace: join(dir, "ws"),
      },
      log: createLogger({ toFile: false, level: "silent" }),
      appDataDir: join(dir, "app"),
      secrets: new MemoryStore(),
      saveConfig: async () => {},
      opener: { file: async () => "default", url: async () => "default" },
    });
  });

  afterEach(async () => {
    await handle.close();
    await rm(dir, { recursive: true, force: true });
    installTex.mockReset();
  });

  function page() {
    const u = new URL(handle.services.onboarding.open().url);
    const headers = { Cookie: `ezapply_page=${u.searchParams.get("t")}`, Origin: u.origin };
    return {
      install: () =>
        fetch(`${u.origin}/onboard/action`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "installTex" }),
        }),
      tex: async () => ((await (await fetch(`${u.origin}/onboard/state`, { headers })).json()) as OnboardState).tex,
    };
  }

  it("runs one install at a time in the background, and shows why it failed", async () => {
    let finish: (r: unknown) => void = () => {};
    installTex.mockImplementation(() => new Promise((r) => (finish = r)));
    const p = page();
    expect(await (await p.install()).json()).toEqual({ install: { status: "running" } });
    await p.install();
    expect(installTex).toHaveBeenCalledTimes(1);
    expect((await p.tex()).install).toEqual({ status: "running" });

    finish({ ok: false, error: "The install didn't finish: cancelled." });
    expect(await waitFor(async () => ((await p.tex()).install?.status === "failed" ? true : null), 5000)).toBe(true);
    expect((await p.tex()).install).toEqual({ status: "failed", error: "The install didn't finish: cancelled." });
  });

  it("says when it went to a Terminal window, and shows nothing once it succeeded", async () => {
    installTex.mockResolvedValueOnce({ terminal: true }).mockResolvedValueOnce({ ok: true });
    const p = page();
    await p.install();
    expect(await waitFor(async () => ((await p.tex()).install?.status === "terminal" ? true : null), 5000)).toBe(true);
    await p.install();
    expect(await waitFor(async () => ((await p.tex()).install === undefined ? true : null), 5000)).toBe(true);
  });
});

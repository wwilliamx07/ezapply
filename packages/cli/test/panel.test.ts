import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CompanionHandle, createLogger } from "@ezapply/companion";
import { afterEach, describe, expect, it } from "vitest";
import { hostPanel } from "../src/panel.js";

const STUB = join(import.meta.dirname, "..", "..", "companion", "test", "claude-stream-stub.mjs");
let dir: string;

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

describe("ezapply (the side panel's mode)", () => {
  it("hosts the companion with Claude Code for the panel's agent, says where to go, and stops on the signal", async () => {
    dir = await mkdtemp(join(tmpdir(), "ezapply-panel-cli-"));
    const port = await freePort();
    const said: string[] = [];
    const opened: string[] = [];
    let stop!: () => void;
    let handle: CompanionHandle | undefined;
    const done = hostPanel({
      config: {
        schemaVersion: 1,
        host: "127.0.0.1",
        port,
        mcpToken: "t".repeat(43),
        pairingToken: "ABCD-EFGH-JKLM-NPQR",
        workspace: join(dir, "ws"),
      },
      claude: { file: process.execPath, args: [STUB], shell: false },
      log: createLogger({ toFile: false, level: "silent" }),
      say: (l) => said.push(l),
      fail: (l) => said.push(`fail: ${l}`),
      stopped: new Promise<void>((r) => {
        stop = r;
      }),
      onStarted: (h) => {
        handle = h;
      },
      companion: {
        appDataDir: join(dir, "app"),
        saveConfig: async () => {},
        opener: {
          file: async () => "default",
          url: async (u) => {
            opened.push(u);
            return "default";
          },
        },
      },
    });
    await expect.poll(() => said.length, { timeout: 20_000 }).toBe(3);
    expect(said[0]).toBe(`ezapply is running (port ${port}).`);
    // A new workspace: setup isn't finished, so its page opens (there's no extension, so no panel, yet).
    expect(said[1]).toBe("Setup isn't finished: the setup page opened in your browser.");
    expect(opened).toEqual([expect.stringMatching(/\/onboard\?t=/)]);
    expect(said[2]).toMatch(/Open the ezapply panel from your browser's toolbar.*Ctrl\+C/);
    // The panel's agent is there, not "unavailable".
    expect(handle?.services.agent.state().status).toBe("idle");
    const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
    expect(health).toMatchObject({ name: "ezapply" });

    stop();
    expect(await done).toBe(0);
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });
});

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { newPairingToken } from "../../config/daemon.js";
import type { Services } from "../../services.js";
import { waitFor } from "../../util/wait.js";
import { tool } from "../result.js";

const PAIRING_MS = 15 * 60_000;

export function registerBrowserTools(server: McpServer, s: Services): void {
  server.registerTool(
    "browser_status",
    {
      title: "Browser status",
      description:
        "Check whether the browser extension is connected and list open tabs (with which ones are Workday). " +
        "Call this first when a browser action fails, and relay the returned hint to the user.",
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "browser_status", async () => {
      const bridge = s.bridge.status();
      const activePostingId = await s.postings.activeId();
      if (!bridge.connected) {
        return {
          companionVersion: s.version,
          extension: bridge,
          activePostingId,
          hint: bridge.paired
            ? "Extension not connected. Ask the user to open their browser; it reconnects automatically. If the badge stays grey, reload the extension."
            : "Extension not paired. Call extension_pair.",
        };
      }
      const browser = await s.bridge.call("browser.status", {}, 5_000);
      return { companionVersion: s.version, extension: bridge, activePostingId, ...browser };
    }),
  );

  server.registerTool(
    "extension_pair",
    {
      title: "Pair the browser extension",
      description:
        "Open pairing for 15 minutes and return what the user must do to load the extension (Chrome or Firefox). " +
        "Once loaded, it connects and pairs by itself, with no code. Relay `tell`, then call extension_pair_wait. " +
        "Pass replace: true to forget the currently paired extension first (switching browsers, or a reinstalled " +
        "Firefox add-on that won't connect).",
      inputSchema: { replace: z.boolean().optional() },
    },
    tool(s.log, "extension_pair", async ({ replace }: { replace?: boolean }) => {
      if (replace) await s.bridge.forgetPaired(newPairingToken());
      const status = s.bridge.status();
      if (status.connected) return { connected: true, extension: status };

      const dir = s.extensionDir;
      const chrome = dir ? join(dir, "dist") : undefined;
      const firefox = dir ? join(dir, "dist-firefox", "manifest.json") : undefined;
      const built = Boolean(chrome && firefox && existsSync(chrome) && existsSync(firefox));
      s.bridge.openPairing(PAIRING_MS);
      return {
        connected: false,
        pairingOpenMinutes: PAIRING_MS / 60_000,
        ...(status.paired ? { alreadyPaired: status.extensionId ?? true } : {}),
        chrome: {
          page: "chrome://extensions",
          steps: "Turn on Developer mode (top right), click Load unpacked, and choose this folder.",
          folder: chrome,
        },
        firefox: {
          page: "about:debugging#/runtime/this-firefox",
          steps:
            "Click Load Temporary Add-on and choose this file. Firefox removes it when it closes; load it again and " +
            "call extension_pair next time. If its options page says it has no access to Workday sites, click Grant site access.",
          manifest: firefox,
        },
        ...(built
          ? {}
          : { hint: "The extension isn't built. Ask the user to run `npm run setup` in the ezapply repo first." }),
        tell:
          "Ask which browser they use, then give them that browser's page, steps and path (paths are copyable). " +
          (status.paired
            ? "An extension is already paired: if it's installed, they only need to open the browser. For a different copy, call extension_pair with replace: true."
            : "It pairs by itself once loaded."),
      };
    }),
  );

  server.registerTool(
    "extension_pair_wait",
    {
      title: "Wait for the extension",
      description: "Block until the browser extension connects (default up to 3 minutes).",
      inputSchema: { timeoutSeconds: z.number().int().min(5).max(900).default(180) },
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "extension_pair_wait", async ({ timeoutSeconds }: { timeoutSeconds: number }) => {
      await waitFor(async () => (s.bridge.status().connected ? true : null), timeoutSeconds * 1000, 500);
      const status = s.bridge.status();
      return status.connected
        ? { connected: true, extension: status }
        : {
            connected: false,
            hint: "Not connected yet. Ask whether they loaded it; if the toolbar badge is red, have them open the extension's options page and read the message.",
          };
    }),
  );
}

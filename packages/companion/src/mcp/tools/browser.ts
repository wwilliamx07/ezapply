import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PAIRING_MS, startPairing } from "../../bridge/pairing.js";
import type { Services } from "../../services.js";
import { waitFor } from "../../util/wait.js";
import { tool } from "../result.js";

export function registerBrowserTools(server: McpServer, s: Services): void {
  server.registerTool(
    "browser_status",
    {
      title: "Browser status",
      description:
        "Check whether the browser extension is connected, which browser it runs in (`extension.browser`: where ezapply " +
        "opens pages and PDFs for the user), and list open tabs (with `site`: a supported job site's id, or generic; " +
        "`frames`: applications embedded in that page, such as a job board's form on a careers page). " +
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
        "Open pairing for 15 minutes and return what the user must do to load the extension (Chrome or another Chromium browser). " +
        "Once loaded, it connects and pairs by itself, with no code. Relay `tell`, then call extension_pair_wait. " +
        "Pass replace: true to forget the currently paired extension first (switching browsers, or a copy loaded " +
        "again from another folder, which gets a new id).",
      inputSchema: { replace: z.boolean().optional() },
    },
    tool(s.log, "extension_pair", async ({ replace }: { replace?: boolean }) => {
      const { connected, status, chrome, built } = await startPairing(s, replace);
      if (connected) return { connected: true, extension: status };
      return {
        connected: false,
        pairingOpenMinutes: PAIRING_MS / 60_000,
        ...(status.paired ? { alreadyPaired: status.extensionId ?? true } : {}),
        chrome: {
          page: "chrome://extensions",
          steps: "Turn on Developer mode (top right), click Load unpacked, and choose this folder.",
          folder: chrome,
        },
        ...(built
          ? {}
          : { hint: "The extension isn't built. Ask the user to run `npm run setup` in the ezapply repo first." }),
        tell:
          "Give them the page, steps and folder (paths are copyable; Edge's page is edge://extensions). " +
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

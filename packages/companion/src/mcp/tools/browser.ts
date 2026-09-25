import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Services } from "../../services.js";
import { tool } from "../result.js";

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
            : "Extension not paired. Ask the user to run `ezapply pair` and paste the code into the extension options page.",
        };
      }
      const browser = await s.bridge.call("browser.status", {}, 5_000);
      return { companionVersion: s.version, extension: bridge, activePostingId, ...browser };
    }),
  );
}

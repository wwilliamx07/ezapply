import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Services } from "../../services.js";
import { tool } from "../result.js";

export function registerOnboardingTools(server: McpServer, s: Services): void {
  // One tool opens the page, reports the last task and waits for the next, so the agent never leaves the page's
  // tasks unread between calls (the lesson of the two review tools that became review_documents).
  server.registerTool(
    "onboarding",
    {
      title: "Onboarding page",
      description:
        "Open the setup page in the user's browser (if it isn't open) and wait for work from it (default up to 10 " +
        "minutes). The user does setup on the page; what needs you comes back as `task` { id, kind, params, how }: " +
        "do what `how` says, then call onboarding { taskId, result: { ok, note? } }, which reports it and waits for " +
        "the next. `done` once the user finishes. `waiting` when nothing came: call onboarding {} again. Use it " +
        "when workspace_check isn't ready, or when the user wants to change a setup step.",
      inputSchema: {
        taskId: z.string().optional().describe("The task you finished."),
        result: z
          .object({
            ok: z.boolean(),
            note: z.string().max(4000).optional().describe("What you did or found, shown on the page."),
          })
          .optional(),
        timeoutSeconds: z.number().int().min(5).max(900).default(600),
      },
    },
    tool(
      s.log,
      "onboarding",
      async ({
        taskId,
        result,
        timeoutSeconds,
      }: {
        taskId?: string;
        result?: { ok: boolean; note?: string };
        timeoutSeconds: number;
      }) => {
        if (taskId) s.onboarding.report(taskId, result ?? { ok: true });
        const { url, pageOpen } = s.onboarding.open();
        if (!pageOpen) {
          const openedIn = await s.opener.url(url).catch(() => null);
          if (!openedIn) {
            // Nobody will see the page unless the agent gives the user the link, so don't wait first.
            return {
              url,
              openedBrowser: false,
              tell: `Ask the user to open ${url} (a page ezapply serves on this computer) to set ezapply up.`,
              hint: "Then wait for its tasks: onboarding {}.",
            };
          }
          const next = await s.onboarding.next(timeoutSeconds * 1000);
          return { url, openedIn, ...next, ...hintFor(next) };
        }
        const next = await s.onboarding.next(timeoutSeconds * 1000);
        return { url, ...next, ...hintFor(next) };
      },
    ),
  );
}

function hintFor(next: object): { hint?: string } {
  if ("waiting" in next) {
    return { hint: "Nothing yet: the user is working on the page. Call onboarding {} again to keep waiting." };
  }
  if ("done" in next) return { hint: "Say in two lines what's ready and what's left (notDone), then stop." };
  return {};
}

import { ONBOARD_STEP_IDS, type OnboardStepId } from "@ezapply/protocol";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Services } from "../../services.js";
import { tool } from "../result.js";

export function registerOnboardingTools(server: McpServer, s: Services): void {
  // One tool opens the page and reports a task. The panel's agent gets each task as a message; without a panel
  // agent (tests), `wait: true` reports the last task and waits for the next in one call, so the agent never
  // leaves the page's tasks unread between calls (the lesson of the two review tools that became review_documents).
  server.registerTool(
    "onboarding",
    {
      title: "Onboarding page",
      description:
        "Open the setup page in the user's browser (if it isn't open), at `step` when given. Use it when " +
        "workspace_check isn't ready, or when the user wants to change a setup step: to add or remove repos, use " +
        "another resume and so on, open that step and tell them they do it there. Never ask in chat for what the " +
        "page collects (a password, a client secret, an address, screening answers). What needs you arrives as a " +
        'message ("Setup task t3 from the setup page …"): do it, then report it with ' +
        "onboarding { taskId, result: { ok, note? } }.",
      inputSchema: {
        step: z.enum(ONBOARD_STEP_IDS).optional().describe("The step to open the page at."),
        taskId: z.string().optional().describe("The task you finished."),
        result: z
          .object({
            ok: z.boolean(),
            note: z.string().max(4000).optional().describe("What you did or found, shown on the page."),
          })
          .optional(),
        timeoutSeconds: z.number().int().min(5).max(900).default(600),
        wait: z
          .boolean()
          .default(false)
          .describe(
            "true only when no panel agent hands you tasks: report, then wait for the next task (up to " +
              "timeoutSeconds), returned as `task` { id, kind, params, how }, `done`, or `waiting` (call again).",
          ),
      },
    },
    tool(
      s.log,
      "onboarding",
      async ({
        step,
        taskId,
        result,
        timeoutSeconds,
        wait,
      }: {
        step?: OnboardStepId;
        taskId?: string;
        result?: { ok: boolean; note?: string };
        timeoutSeconds: number;
        wait: boolean;
      }) => {
        if (taskId) s.onboarding.report(taskId, result ?? { ok: true });
        if (!wait) {
          // The panel's agent: tasks come as messages, so it reports, or opens the page, and goes on.
          if (taskId) return { reported: true };
          const { url, pageOpen } = s.onboarding.open(step);
          if (pageOpen) return { url, pageOpen: true, ...(step ? { showing: step } : {}) };
          const openedIn = await s.opener.url(url).catch(() => null);
          return openedIn
            ? { url, openedIn }
            : { url, openedBrowser: false, tell: `Ask the user to open ${url} to set ezapply up.` };
        }
        const { url, pageOpen } = s.onboarding.open(step);
        if (!pageOpen) {
          const openedIn = await s.opener.url(url).catch(() => null);
          if (!openedIn) {
            // Nobody will see the page unless the agent gives the user the link, so don't wait first.
            return {
              url,
              openedBrowser: false,
              tell: `Ask the user to open ${url} (a page ezapply serves on this computer) to set ezapply up.`,
              hint: "Then wait for its tasks: onboarding { wait: true }.",
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
    return {
      hint: "Nothing yet: the user is working on the page. Call onboarding { wait: true } again to keep waiting.",
    };
  }
  if ("done" in next) return { hint: "Say in two lines what's ready and what's left (notDone), then stop." };
  return {};
}

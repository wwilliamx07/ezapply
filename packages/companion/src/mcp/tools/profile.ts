import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Services } from "../../services.js";
import { workspaceStatus } from "../../status.js";
import { tool } from "../result.js";

export function registerProfileTools(server: McpServer, s: Services): void {
  server.registerTool(
    "workspace_check",
    {
      title: "Workspace readiness",
      description:
        "Onboarding checklist: TeX, extension, GitHub login, selected repos, knowledge base, resume/cover templates, " +
        "profile, answer bank, preferences, library. Returns `nextStep`, the first required item not done. The " +
        "ezapply-onboard skill walks these in order.",
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "workspace_check", () => workspaceStatus(s)),
  );

  server.registerTool(
    "workspace_changes",
    {
      title: "What's out of date",
      description:
        "What in the workspace is behind its source: a selected repo with commits since it was indexed, knowledge from " +
        "a repo no longer selected, a template whose source folder changed since import, the resume template edited " +
        "since the profile was updated from it (with the diff), the profile's identity or contact changed since the " +
        "cover template's fields were set. Call once at the start of a session; `{ changes: [] }` means all current. " +
        "Repos are checked once per chat in the background (`pending` while that runs; `refresh` checks them again).",
      inputSchema: { refresh: z.boolean().optional().describe("Check the repos again") },
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "workspace_changes", ({ refresh }: { refresh?: boolean }) =>
      s.freshness.changes(refresh === undefined ? {} : { refresh }),
    ),
  );

  server.registerTool(
    "workspace_change_mark",
    {
      title: "Mark a workspace change",
      description:
        "`later`: hide a change for the rest of this chat (the user put it off). `done`: record the derived part as " +
        "current: a template's source (after re-importing, or when the difference doesn't matter), the profile after " +
        "updating it from the resume diff, the cover fields after updating them from the profile. For `repo-deselected`, " +
        "`done` DELETES that repo's knowledge folder and cache: ask the user first. A repo's new commits can't be " +
        "marked done: re-index it (knowledge_mark_indexed ends them).",
      inputSchema: {
        id: z.string().describe("A change id from workspace_changes"),
        as: z.enum(["done", "later"]),
      },
    },
    tool(s.log, "workspace_change_mark", ({ id, as }: { id: string; as: "done" | "later" }) =>
      s.freshness.mark(id, as),
    ),
  );

  server.registerTool(
    "profile_check",
    {
      title: "Validate profile",
      description:
        "Validate profile/profile.yaml against the schema. Returns errors with field paths, or commonly-needed fields " +
        "that are still missing. Call after every edit to the profile.",
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "profile_check", () => s.profile.checkProfile()),
  );

  server.registerTool(
    "answers_check",
    {
      title: "Validate answer bank",
      description:
        "Validate profile/answers.yaml and list unanswered questions (with suggested defaults and profile sources). " +
        "Call after every edit to the answer bank.",
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "answers_check", () => s.profile.checkAnswers()),
  );
}

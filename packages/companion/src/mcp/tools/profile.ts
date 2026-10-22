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
        "onboarding page shows these as its steps (onboarding {}).",
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
        "a repo no longer selected, a template whose source folder changed since import (or that was imported from a " +
        "scratchpad copy, so nothing is watched), a LaTeX document in library/ that no template came from, the resume " +
        "template edited since the profile was updated from it (with the diff), the profile's identity or contact " +
        "changed since the cover template's fields were set. The user sees these on the panel's Workspace changes card " +
        "(or the setup page) and updates them there: use this to answer what they put off (`deferred`: repos, with " +
        "when they're checked again) or what's out of date. Repos are checked once per run in the background " +
        "(`pending` while that runs; `refresh` checks them again).",
      inputSchema: { refresh: z.boolean().optional().describe("Check the repos again") },
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "workspace_changes", ({ refresh }: { refresh?: boolean }) =>
      s.freshness.changes(refresh === undefined ? {} : { refresh }),
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
        "Validate profile/answers.yaml and list unanswered questions (with suggested defaults), and the ones answered " +
        "from the profile (fromProfile: the profile path and what it holds now; missing value = not in the profile). " +
        "Call after every edit to the answer bank.",
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "answers_check", () => s.profile.checkAnswers()),
  );
}

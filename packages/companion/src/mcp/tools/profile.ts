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

  server.registerTool(
    "template_import",
    {
      title: "Import LaTeX template",
      description:
        "Copy the user's LaTeX project (resume or cover letter) from a folder on their machine into templates/<kind>/, " +
        "skipping build artifacts, and record the main .tex. Replaces ezapply's default cover template without asking. " +
        "If the user already has a template there, confirm with them and pass replace: true (the old one is kept in " +
        "templates/.old/). A main file that uses pdfTeX-only commands and no fontspec gets `% !TEX program = " +
        "pdflatex` added as its first line so it builds with pdflatex; the result's texProgram says so.",
      inputSchema: {
        sourceDir: z.string().describe("Absolute path of the folder holding the .tex sources."),
        kind: z.enum(["resume", "cover"]),
        main: z.string().optional().describe("Main .tex relative to sourceDir, when auto-detection is ambiguous."),
        replace: z.boolean().optional(),
      },
    },
    tool(
      s.log,
      "template_import",
      (args: { sourceDir: string; kind: "resume" | "cover"; main?: string; replace?: boolean }) =>
        s.profile.importTemplate(args),
    ),
  );

  server.registerTool(
    "template_import_example",
    {
      title: "Import example cover letter",
      description:
        "Copy a sample cover letter the user likes (PDF, PNG/JPG/WebP, TXT or MD) from their machine into " +
        "templates/cover/example/, so you can read it and rebuild the cover template in its layout. Word files must be " +
        "exported to PDF first. Only the format is reused, never its wording.",
      inputSchema: {
        sourcePath: z.string().describe("Absolute path of the example file."),
      },
    },
    tool(s.log, "template_import_example", (args: { sourcePath: string }) => s.profile.importExample(args)),
  );

  server.registerTool(
    "template_set_main",
    {
      title: "Set template entry point",
      description:
        "Record which .tex file in templates/<kind>/ is the main document. Call it after creating or reworking a " +
        "template (e.g. from an example letter); that marks it as no longer ezapply's default.",
      inputSchema: {
        kind: z.enum(["resume", "cover"]),
        main: z.string().describe("Path relative to templates/<kind>/."),
      },
    },
    tool(s.log, "template_set_main", async ({ kind, main }: { kind: "resume" | "cover"; main: string }) => {
      await s.profile.setTemplateMain(kind, main);
      return { kind, main: await s.profile.templateMain(kind) };
    }),
  );
}

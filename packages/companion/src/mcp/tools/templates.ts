import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Services } from "../../services.js";
import { tool } from "../result.js";

export function registerTemplateTools(server: McpServer, s: Services): void {
  server.registerTool(
    "template_import",
    {
      title: "Import LaTeX template",
      description:
        "Copy the user's LaTeX project (resume or cover letter) from a folder on their machine into templates/<kind>/, " +
        "skipping build artifacts, and record the main .tex. Replaces ezapply's default cover template without asking. " +
        "If the user already has a template there, confirm with them and pass replace: true (the old one is kept in " +
        "templates/.old/). A main file that uses pdfTeX-only commands and no fontspec gets `% !TEX program = " +
        "pdflatex` added as its first line so it builds with pdflatex; the result's texProgram says so. contentFiles lists " +
        "the .tex files the main file \\inputs (relative to it): tailored copies need them too.",
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
        s.templates.importTemplate(args),
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
    tool(s.log, "template_import_example", (args: { sourcePath: string }) => s.templates.importExample(args)),
  );

  server.registerTool(
    "template_set_main",
    {
      title: "Set template entry point",
      description:
        "Record which .tex file in templates/<kind>/ is the main document, and the files it \\inputs. Call it after " +
        "creating or reworking a template (e.g. from an example letter); that marks it as no longer ezapply's default.",
      inputSchema: {
        kind: z.enum(["resume", "cover"]),
        main: z.string().describe("Path relative to templates/<kind>/."),
      },
    },
    tool(s.log, "template_set_main", async ({ kind, main }: { kind: "resume" | "cover"; main: string }) => ({
      kind,
      ...(await s.templates.setTemplateMain(kind, main)),
    })),
  );
}

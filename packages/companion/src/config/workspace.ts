import { z } from "zod";

/** ezapply.config.json at the workspace root. Bump schemaVersion and add a migration on breaking change. */
export const WorkspaceConfig = z.object({
  schemaVersion: z.literal(1),
  resume: z
    .object({
      pageLimit: z.number().int().min(1).default(1),
      pageSize: z.enum(["letter", "a4"]).default("letter"),
    })
    .default({ pageLimit: 1, pageSize: "letter" }),
  tex: z
    .object({
      // "auto" picks latexmk, then xelatex, lualatex, tectonic: whichever is installed.
      // XeLaTeX/LuaLaTeX are needed for system fonts (fontspec).
      engine: z.enum(["auto", "latexmk", "xelatex", "lualatex", "pdflatex", "tectonic"]).default("auto"),
      latexmkFlags: z.array(z.string()).default(["-xelatex"]),
      timeoutSeconds: z.number().int().min(10).max(600).default(120),
    })
    .default({ engine: "auto", latexmkFlags: ["-xelatex"], timeoutSeconds: 120 }),
  pdf: z
    .object({
      /** Upload size limit used when none is known for a form. */
      defaultMaxBytes: z
        .number()
        .int()
        .positive()
        .default(5 * 1024 * 1024),
    })
    .default({ defaultMaxBytes: 5 * 1024 * 1024 }),
  documents: z
    .object({
      /**
       * after-approval: generated documents are shown in the browser (review_documents) and attached only once the
       * user approves that exact version on the page; upload_file refuses anything else from postings/.
       * immediately: attached as soon as they're built.
       */
      attach: z.enum(["after-approval", "immediately"]).default("after-approval"),
    })
    .default({ attach: "after-approval" }),
  decisions: z.object({ provider: z.enum(["none"]).default("none") }).default({ provider: "none" }),
  context: z
    .object({
      /**
       * Under `ezapply chat`, capturing a different posting restarts Claude with a fresh session, so the last
       * posting's conversation stops being re-sent with every turn.
       */
      restartOnCapture: z.boolean().default(true),
    })
    .default({ restartOnCapture: true }),
});
export type AttachMode = WorkspaceConfig["documents"]["attach"];
export type WorkspaceConfig = z.infer<typeof WorkspaceConfig>;

export function defaultWorkspaceConfig(): WorkspaceConfig {
  return WorkspaceConfig.parse({ schemaVersion: 1 });
}

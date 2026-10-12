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
  debug: z
    .object({
      /** Debug mode: every form call is recorded under debug/ in the workspace (forms/debug.ts). */
      enabled: z.boolean().default(false),
      /** debug/ is kept under this size: the oldest sessions go first. */
      maxMB: z.number().int().min(1).max(100_000).default(500),
      /**
       * The page's markup in each record: "failures" saves it before each call and at every field that fails,
       * "always" also after each call, "none" never (the trace is still recorded). A bad value falls back to
       * "failures" rather than failing every form call.
       */
      markup: z.enum(["failures", "always", "none"]).default("failures").catch("failures"),
    })
    .default({ enabled: false, maxMB: 500, markup: "failures" }),
});
export type AttachMode = WorkspaceConfig["documents"]["attach"];
export type WorkspaceConfig = z.infer<typeof WorkspaceConfig>;

export function defaultWorkspaceConfig(): WorkspaceConfig {
  return WorkspaceConfig.parse({ schemaVersion: 1 });
}

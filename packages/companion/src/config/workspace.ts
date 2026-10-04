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
  forms: z
    .object({
      /**
       * on: autofill_step fills, without the model, what the profile and the answer bank decide (forms/autofill.ts).
       * off: it fills nothing and returns the whole step, so a run can be compared with and without it.
       */
      autofill: z.enum(["on", "off"]).default("on"),
      /**
       * on: a form call that changes the page brings the browser window to the front first (tab.show's
       * focusWindow). Widgets that track focus need it: Chrome sends no focus events to a window behind another
       * app, and Workday's split dates weren't taken there. The cost: the browser comes in front of the
       * terminal, and takes keyboard focus, on each such call. off: only the tab is switched to, within its
       * window. A bad value falls back to on rather than failing every form call.
       */
      focusBrowser: z.enum(["on", "off"]).default("on").catch("on"),
    })
    .default({ autofill: "on", focusBrowser: "on" }),
  debug: z
    .object({
      /** Autofill debug mode: every form call is recorded under debug/ in the workspace (forms/debug.ts). */
      autofill: z.boolean().default(false),
      /** debug/ is kept under this size: the oldest sessions go first. */
      maxMB: z.number().int().min(1).max(100_000).default(500),
    })
    .default({ autofill: false, maxMB: 500 }),
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

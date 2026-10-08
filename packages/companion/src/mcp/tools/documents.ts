import { diffPages, ErrorCode, EzError } from "@ezapply/protocol";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Services } from "../../services.js";
import { rawTool, tool } from "../result.js";

const PATH_NOTE = "Paths may be absolute or relative to the workspace root.";

export function registerDocumentTools(server: McpServer, s: Services): void {
  server.registerTool(
    "tex_compile",
    {
      title: "Compile LaTeX",
      description:
        "Compile a .tex file (under postings/ or templates/) to a PDF next to it, without shell escape. Returns the " +
        "PDF, page count, and diagnostics with line numbers (overfull boxes, missing glyphs). *resume*/*cv* files are " +
        "checked against the page limit; over it, `overflow` gives the lines past it and their text. Successful builds are snapshotted to .history/. Engine: the file's " +
        `\`% !TEX program\` comment, else tex.engine (engine, engineFrom say which). ${PATH_NOTE}`,
      inputSchema: {
        path: z.string().describe("The .tex file."),
        maxPages: z.number().int().min(1).optional().describe("Override the page limit check for this document."),
      },
    },
    tool(s.log, "tex_compile", ({ path, maxPages }: { path: string; maxPages?: number }) =>
      s.documents.compile(path, maxPages === undefined ? {} : { maxPages }),
    ),
  );

  server.registerTool(
    "tex_diff",
    {
      title: "Diff LaTeX versions",
      description:
        "Produce a change-highlighted PDF between two .tex files with latexdiff (e.g. templates/resume/main.tex vs the " +
        `tailored copy). Only when the user asks to see changes. ${PATH_NOTE}`,
      inputSchema: { oldPath: z.string(), newPath: z.string() },
    },
    tool(s.log, "tex_diff", ({ oldPath, newPath }: { oldPath: string; newPath: string }) =>
      s.documents.diff(oldPath, newPath),
    ),
  );

  server.registerTool(
    "pdf_render",
    {
      title: "Render PDF page",
      description:
        "Render one PDF page to an image so you can check layout visually (alignment, overflow, awkward breaks). " +
        `A PNG copy is saved to .previews/ next to the PDF. ${PATH_NOTE}`,
      inputSchema: {
        path: z.string(),
        page: z.number().int().min(1).default(1),
        scale: z.number().min(0.5).max(3).default(1.5).describe("1.0 = 72 dpi."),
      },
      annotations: { readOnlyHint: true },
    },
    rawTool(s.log, "pdf_render", async ({ path, page, scale }: { path: string; page: number; scale: number }) => {
      const { png, savedTo } = await s.documents.render(path, page, scale);
      return {
        content: [
          { type: "image", data: png.toString("base64"), mimeType: "image/png" },
          { type: "text", text: JSON.stringify({ page, savedTo }) },
        ],
      };
    }),
  );

  server.registerTool(
    "pdf_text",
    {
      title: "Extract PDF text",
      description:
        "Extract text in reading order, per page, as an ATS would parse it. Use to confirm headings and keywords come " +
        "through as plain text in a sensible order. With sinceReviewed: true (a PDF in a posting folder), instead " +
        "what changed in its text since the user last answered a review of it, word by word, as the review page " +
        `marks it: quote these changes when reporting a revision. ${PATH_NOTE}`,
      inputSchema: {
        path: z.string(),
        pages: z.string().optional().describe('1-based selection like "1" or "1-2,4". Default: all.'),
        sinceReviewed: z
          .boolean()
          .optional()
          .describe("The changes since the last review instead of the text (pages is ignored)."),
      },
      annotations: { readOnlyHint: true },
    },
    tool(
      s.log,
      "pdf_text",
      async ({ path, pages, sinceReviewed }: { path: string; pages?: string; sinceReviewed?: boolean }) => {
        if (!sinceReviewed) return s.documents.text(path, pages);
        const abs = s.workspace.resolveAllowed(path, ["postings"]);
        const last = await s.reviews.lastReviewed(abs);
        if (!last) {
          return {
            firstReview: true,
            hint: "The user hasn't answered a review of this document yet, so there's nothing to compare with.",
          };
        }
        const now = (await s.documents.text(path)).map((p) => p.text);
        return {
          since: { reviewedAt: last.at, reviewId: last.reviewId },
          changes: diffPages(last.pages, now),
        };
      },
    ),
  );

  server.registerTool(
    "pdf_info",
    {
      title: "PDF info",
      description: `Page count, file size, page sizes, encryption, text layer presence and metadata. ${PATH_NOTE}`,
      inputSchema: { path: z.string() },
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "pdf_info", ({ path }: { path: string }) => s.documents.info(path)),
  );

  server.registerTool(
    "pdf_merge",
    {
      title: "Merge PDFs",
      description:
        "Combine PDFs into one (for postings that require a single document). Inputs from postings/, templates/ or " +
        "library/, output under postings/ or library/. Adds a bookmark per input, can take page ranges, and by default " +
        'normalizes page sizes to the first page ("auto") so the bundle looks consistent. Name bundles like ' +
        `Last_First_Company_Application.pdf. ${PATH_NOTE}`,
      inputSchema: {
        inputs: z
          .array(
            z.object({
              path: z.string(),
              pages: z.string().optional().describe('1-based selection like "1-2". Default: all pages.'),
              label: z.string().optional().describe('Bookmark label, e.g. "Cover Letter". Default: file name.'),
            }),
          )
          .min(1),
        output: z.string().describe("Output .pdf path."),
        bookmarks: z.boolean().default(true),
        normalize: z.enum(["auto", "none", "letter", "a4"]).default("auto"),
        title: z.string().optional().describe("PDF title metadata."),
        author: z.string().optional().describe("PDF author metadata."),
      },
    },
    tool(
      s.log,
      "pdf_merge",
      ({
        inputs,
        output,
        ...opts
      }: {
        inputs: { path: string; pages?: string; label?: string }[];
        output: string;
        bookmarks: boolean;
        normalize: "auto" | "none" | "letter" | "a4";
        title?: string;
        author?: string;
      }) => s.documents.merge(inputs, output, opts),
    ),
  );

  server.registerTool(
    "pdf_from_images",
    {
      title: "Images to PDF",
      description: `Turn scans or photos (PNG, JPEG, WebP, …) into a PDF, one image per page. ${PATH_NOTE}`,
      inputSchema: {
        images: z.array(z.string()).min(1),
        output: z.string().describe("Output .pdf path under postings/ or library/."),
        pageSize: z.enum(["letter", "a4"]).default("letter"),
      },
    },
    tool(
      s.log,
      "pdf_from_images",
      ({ images, output, pageSize }: { images: string[]; output: string; pageSize: "letter" | "a4" }) =>
        s.documents.fromImages(images, output, pageSize),
    ),
  );

  server.registerTool(
    "pdf_compress",
    {
      title: "Compress PDF",
      description:
        "Shrink a PDF to fit an upload limit: lossless re-save first, then Ghostscript image downsampling if installed. " +
        `Reports before/after size and whether the target was met. ${PATH_NOTE}`,
      inputSchema: {
        path: z.string(),
        output: z.string().optional().describe("Default: overwrite the input."),
        targetBytes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Default: pdf.defaultMaxBytes from config (5 MB)."),
      },
    },
    tool(
      s.log,
      "pdf_compress",
      ({ path, output, targetBytes }: { path: string; output?: string; targetBytes?: number }) =>
        s.documents.compress(path, output, targetBytes),
    ),
  );

  // One tool opens the page and waits for the answer. With a separate wait call the agent opened reviews three
  // times without waiting, and the user's answers sat unread until they asked.
  server.registerTool(
    "review_documents",
    {
      title: "Have the user review documents",
      description:
        "In the after-approval attach mode: open a page in the user's browser showing these PDFs (one posting's " +
        "resume, cover letter or bundle) and wait for the answer (default up to 10 minutes): documents approved, " +
        "and for each one to change, the user's request and comments on passages ({ page, quote, note }: the words " +
        "they selected and what to change there). The page shows the PDFs as they are now, so after any rebuild call this again with " +
        "the changed files. Only approval on the page lets upload_file attach a document, in the version shown. " +
        "With reviewId instead of files: wait again for a review that timed out.",
      inputSchema: {
        files: z
          .array(z.string())
          .min(1)
          .max(6)
          .optional()
          .describe("PDFs under postings/<id>/, e.g. postings/<id>/resume.pdf."),
        reviewId: z.string().optional().describe("A review that timed out, to wait for again (instead of files)."),
        timeoutSeconds: z.number().int().min(5).max(900).default(600),
      },
    },
    tool(
      s.log,
      "review_documents",
      async ({ files, reviewId, timeoutSeconds }: { files?: string[]; reviewId?: string; timeoutSeconds: number }) => {
        if ((files === undefined) === (reviewId === undefined)) {
          throw new EzError(
            ErrorCode.BadRequest,
            "Give either files or reviewId.",
            "files opens a new review; reviewId waits again for one that timed out.",
          );
        }
        if (reviewId !== undefined) return { reviewId, ...(await s.reviews.wait(reviewId, timeoutSeconds * 1000)) };
        const review = await s.reviews.open(files as string[]);
        const openedIn = await s.opener.url(review.url).catch(() => null);
        if (!openedIn) {
          // Nobody will see the page unless the agent gives the user the link, so don't wait first.
          return {
            ...review,
            done: false,
            openedBrowser: false,
            tell: `Ask the user to open ${review.url} to approve the documents or write what should change.`,
            hint: `Then wait for the answer: review_documents { reviewId: "${review.reviewId}" }.`,
          };
        }
        const answer = await s.reviews.wait(review.reviewId, timeoutSeconds * 1000);
        return { ...review, openedIn, ...answer };
      },
    ),
  );

  server.registerTool(
    "attach_mode_set",
    {
      title: "Set the attach mode",
      description:
        "How generated documents reach applications: after-approval (shown in the browser, attached once the user " +
        "approves) or immediately (attached as soon as they're built). Saved in ezapply.config.json. Only when the " +
        "user asks for it.",
      inputSchema: { mode: z.enum(["after-approval", "immediately"]) },
    },
    tool(s.log, "attach_mode_set", async ({ mode }: { mode: "after-approval" | "immediately" }) => ({
      attachMode: await s.reviews.setAttachMode(mode),
    })),
  );

  server.registerTool(
    "open_file",
    {
      title: "Open for the user",
      description:
        "Open a generated file (usually a PDF) for the user to look at: PDFs and images in the browser they use with " +
        "the ezapply extension, other files in their default application. Use after producing " +
        `or changing a document the user will want to see. ${PATH_NOTE}`,
      inputSchema: { path: z.string() },
    },
    tool(s.log, "open_file", ({ path }: { path: string }) => s.documents.open(path)),
  );
}

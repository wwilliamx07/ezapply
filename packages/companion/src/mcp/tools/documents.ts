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
        "Compile a .tex file (under postings/ or templates/) to PDF next to it, with shell-escape disabled. Returns the PDF " +
        "path, page count, and errors/warnings with line numbers (overfull boxes, missing fonts or glyphs). Files named " +
        "*resume*/*cv* are checked against the configured page limit (default 1). Each successful build is snapshotted " +
        "into .history/ beside the file so earlier versions can be restored. The engine comes from a " +
        "`% !TEX program = pdflatex|xelatex|lualatex|tectonic` comment in the file's first 20 lines, else from " +
        `tex.engine in ezapply.config.json; the result says which (engine, engineFrom). ${PATH_NOTE}`,
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
        `through as plain text in a sensible order. ${PATH_NOTE}`,
      inputSchema: {
        path: z.string(),
        pages: z.string().optional().describe('1-based selection like "1" or "1-2,4". Default: all.'),
      },
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "pdf_text", ({ path, pages }: { path: string; pages?: string }) => s.documents.text(path, pages)),
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

  server.registerTool(
    "open_file",
    {
      title: "Open for the user",
      description:
        "Open a generated file (usually a PDF) in the user's default viewer so they can look at it. Use after producing " +
        `or changing a document the user will want to see. ${PATH_NOTE}`,
      inputSchema: { path: z.string() },
    },
    tool(s.log, "open_file", ({ path }: { path: string }) => s.documents.open(path)),
  );
}

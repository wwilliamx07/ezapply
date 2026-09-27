import { appendFile, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { ErrorCode, EzError, FillValue, PageAction, type PostingStatus } from "@ezapply/protocol";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Services } from "../../services.js";
import { rawTool, tool } from "../result.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".rtf": "application/rtf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const Source = z
  .enum(["profile", "answer-bank", "computed", "user", "judgment"])
  .describe(
    "Where the value came from: profile.yaml, answers.yaml, computed from the profile, the user in chat, or your judgment.",
  );

const tabId = z.number().int().optional().describe("Defaults to the active Workday tab.");

export function registerFormTools(server: McpServer, s: Services): void {
  /** Append to the active posting's form-log.jsonl (the audit trail for "what did we submit"). */
  const logEvent = async (event: Record<string, unknown>) => {
    const id = await s.postings.activeId();
    if (!id) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
    await appendFile(join(s.postings.folder(id), "form-log.jsonl"), `${line}\n`, "utf8");
  };
  const setStatus = async (status: PostingStatus) => {
    const id = await s.postings.activeId();
    if (!id) return;
    const meta = await s.postings.get(id);
    const order: PostingStatus[] = ["captured", "drafting", "attached", "filled", "submitted"];
    if (order.indexOf(status) > order.indexOf(meta.status)) await s.postings.updateMeta(id, { status });
  };

  server.registerTool(
    "get_form",
    {
      title: "Read application page",
      description:
        "Read the current Workday page: pageKind (posting, auth, start-choice, step, review, confirmation), step title " +
        "and progress, and every field grouped by section with id, label, kind, required, current value, known " +
        "options, validation error and a profile hint for well-known fields. Also lists add buttons for repeatable " +
        "sections and available page actions. Call at the start of every step and after anything changes the page.",
      inputSchema: { tabId },
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "get_form", async ({ tabId }: { tabId?: number }) => {
      const form = await s.bridge.call("form.get", tabId === undefined ? {} : { tabId }, 20_000);
      if (form.pageKind === "confirmation") {
        await setStatus("submitted");
        await logEvent({ event: "confirmation-seen", url: form.url });
      }
      if (form.pageKind === "review") await setStatus("filled");
      return form;
    }),
  );

  server.registerTool(
    "list_options",
    {
      title: "List field options",
      description:
        "Open a dropdown or typeahead and list its options (for typeahead, the top level; options with hasChildren " +
        "open a sub-menu, so select them with a path like 'Job Board > LinkedIn').",
      inputSchema: { fieldId: z.string(), tabId },
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "list_options", ({ fieldId, tabId }: { fieldId: string; tabId?: number }) =>
      s.bridge.call("form.listOptions", { fieldId, ...(tabId === undefined ? {} : { tabId }) }, 20_000),
    ),
  );

  server.registerTool(
    "search_options",
    {
      title: "Search typeahead",
      description: "Type a query into a typeahead field (school, field of study, source…) and return matching options.",
      inputSchema: { fieldId: z.string(), query: z.string().min(1), tabId },
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "search_options", ({ fieldId, query, tabId }: { fieldId: string; query: string; tabId?: number }) =>
      s.bridge.call("form.searchOptions", { fieldId, query, ...(tabId === undefined ? {} : { tabId }) }, 20_000),
    ),
  );

  server.registerTool(
    "fill_fields",
    {
      title: "Fill fields",
      description:
        "Fill fields on the current step. Values: text for text/textarea; the option text for dropdown and radio " +
        '(closest match is used); a string or array for typeahead ("Category > Item" for nested menus); true/false ' +
        'for a checkbox; an array of labels for checkbox groups; "YYYY-MM-DD", "YYYY-MM" or "YYYY" for dates. ' +
        "Returns per field: ok, the value read back, errors, and available options when nothing matched. Never " +
        "use it for passwords or EEO answers the user has not provided. Each fill is logged with its source.",
      inputSchema: {
        fills: z
          .array(
            z.object({
              fieldId: z.string(),
              value: FillValue,
              source: Source,
              answerId: z.string().optional().describe("answers.yaml id when source is answer-bank."),
            }),
          )
          .min(1),
        tabId,
      },
    },
    tool(
      s.log,
      "fill_fields",
      async ({
        fills,
        tabId,
      }: {
        fills: { fieldId: string; value: z.infer<typeof FillValue>; source: string; answerId?: string }[];
        tabId?: number;
      }) => {
        const results = await s.bridge.call(
          "form.fill",
          { fills: fills.map(({ fieldId, value }) => ({ fieldId, value })), ...(tabId === undefined ? {} : { tabId }) },
          120_000,
        );
        for (const f of fills) {
          const r = results.find((x) => x.fieldId === f.fieldId);
          await logEvent({
            event: "fill",
            fieldId: f.fieldId,
            value: f.value,
            source: f.source,
            ...(f.answerId ? { answerId: f.answerId } : {}),
            ok: r?.ok ?? false,
            ...(r?.error ? { error: r.error } : {}),
          });
        }
        return results;
      },
    ),
  );

  server.registerTool(
    "upload_file",
    {
      title: "Attach a file",
      description:
        "Upload a file from postings/ or library/ (usually the tailored resume.pdf, cover.pdf or a bundle) into a " +
        "file field. Confirms by reading back the newly shown file name. If the field still holds files from a " +
        "previous application (get_form shows them as its value), remove them with remove_items first.",
      inputSchema: { fieldId: z.string(), path: z.string().describe("Workspace-relative or absolute path."), tabId },
    },
    tool(s.log, "upload_file", async ({ fieldId, path, tabId }: { fieldId: string; path: string; tabId?: number }) => {
      const abs = s.workspace.resolveAllowed(path, ["postings", "library"]);
      const size = (await stat(abs).catch(() => null))?.size;
      if (size === undefined) throw new EzError(ErrorCode.NotFound, `File not found: ${abs}`);
      if (size > MAX_UPLOAD_BYTES) {
        throw new EzError(ErrorCode.BadRequest, `File is ${(size / 1e6).toFixed(1)} MB.`, "Use pdf_compress first.");
      }
      const file = {
        name: basename(abs),
        mimeType: MIME[extname(abs).toLowerCase()] ?? "application/octet-stream",
        base64: (await readFile(abs)).toString("base64"),
      };
      const result = await s.bridge.call(
        "form.upload",
        { fieldId, file, ...(tabId === undefined ? {} : { tabId }) },
        90_000,
      );
      await logEvent({
        event: "upload",
        fieldId,
        file: abs,
        ok: result.ok,
        ...(result.error ? { error: result.error } : {}),
      });
      if (result.ok) await setStatus("attached");
      return result;
    }),
  );

  server.registerTool(
    "remove_items",
    {
      title: "Remove selections or attachments",
      description:
        "Remove selected entries from a multi-select field (kind typeahead, e.g. Skills) or attached files from a " +
        "file field (e.g. Resume/CV, Cover Letter). Workday pre-fills both from the user's last application, so an " +
        "old cover letter or another job's skills list may already be there: remove what doesn't belong to this " +
        "application before uploading or filling. values: labels or file names as get_form shows them (matched " +
        "like fill values); omit to remove everything in the field. Returns removed, remaining, and notFound. " +
        "Logged in form-log.jsonl.",
      inputSchema: {
        fieldId: z.string(),
        values: z.array(z.string()).min(1).optional().describe("Entries to remove; omit to clear the field."),
        reason: z.string().optional().describe("Why, for the log, e.g. 'left from a previous application'."),
        tabId,
      },
    },
    tool(
      s.log,
      "remove_items",
      async ({
        fieldId,
        values,
        reason,
        tabId,
      }: {
        fieldId: string;
        values?: string[];
        reason?: string;
        tabId?: number;
      }) => {
        const result = await s.bridge
          .call(
            "form.remove",
            { fieldId, ...(values ? { values } : {}), ...(tabId === undefined ? {} : { tabId }) },
            60_000,
          )
          .catch((err: unknown) => {
            const e = EzError.from(err);
            if (/Unknown method form\.remove/.test(e.message)) {
              throw new EzError(
                ErrorCode.BadRequest,
                "The browser extension is older than this companion and can't remove items.",
                "Ask the user to rebuild (npm run build) and reload the ezapply extension, then retry.",
              );
            }
            throw e;
          });
        await logEvent({
          event: "remove",
          fieldId,
          removed: result.removed,
          remaining: result.remaining,
          ...(reason ? { reason } : {}),
          ok: result.ok,
          ...(result.error ? { error: result.error } : {}),
        });
        return result;
      },
    ),
  );

  server.registerTool(
    "add_repeatable",
    {
      title: "Add a repeatable row",
      description:
        "Press an add button from get_form.addButtons (e.g. another Work Experience), then call get_form again.",
      inputSchema: { addButtonId: z.string(), tabId },
    },
    tool(s.log, "add_repeatable", ({ addButtonId, tabId }: { addButtonId: string; tabId?: number }) =>
      s.bridge.call("form.addRepeatable", { addButtonId, ...(tabId === undefined ? {} : { tabId }) }, 20_000),
    ),
  );

  server.registerTool(
    "go_next",
    {
      title: "Next step",
      description:
        "Press Next / Save and Continue. Refuses on the review page and on any Submit button: the user always " +
        "submits. Returns whether the step advanced, the new pageKind/step, and validation errors if it did not.",
      inputSchema: { tabId },
    },
    tool(s.log, "go_next", async ({ tabId }: { tabId?: number }) => {
      const r = await s.bridge.call("form.next", tabId === undefined ? {} : { tabId }, 60_000);
      await logEvent({ event: "next", advanced: r.advanced, pageKind: r.pageKind, step: r.step?.title });
      if (r.pageKind === "review") await setStatus("filled");
      return r;
    }),
  );

  server.registerTool(
    "page_action",
    {
      title: "Start-page action",
      description:
        "On a posting or start-choice page: apply (the Apply button), apply_manually (preferred), " +
        "autofill_with_resume, or use_last_application.",
      inputSchema: { action: PageAction, tabId },
    },
    tool(s.log, "page_action", ({ action, tabId }: { action: z.infer<typeof PageAction>; tabId?: number }) =>
      s.bridge.call("form.pageAction", { action, ...(tabId === undefined ? {} : { tabId }) }, 30_000),
    ),
  );

  server.registerTool(
    "screenshot",
    {
      title: "Screenshot tab",
      description:
        "Capture the visible part of the application tab, to understand a widget or error the schema does not explain.",
      inputSchema: { tabId },
      annotations: { readOnlyHint: true },
    },
    rawTool(s.log, "screenshot", async ({ tabId }: { tabId?: number }) => {
      const r = await s.bridge.call("tab.screenshot", tabId === undefined ? {} : { tabId }, 15_000);
      return {
        content: [
          { type: "image", data: r.pngBase64, mimeType: "image/png" },
          { type: "text", text: JSON.stringify({ tabId: r.tabId }) },
        ],
      };
    }),
  );
}

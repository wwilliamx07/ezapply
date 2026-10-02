import { ErrorCode, EzError, FillValue, PageAction } from "@ezapply/protocol";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FillSource } from "../../forms/service.js";
import type { Services } from "../../services.js";
import { rawTool, tool } from "../result.js";

const Source = z
  .enum(["profile", "answer-bank", "computed", "user", "judgment"])
  .describe(
    "Where the value came from: profile.yaml, answers.yaml, computed from the profile, the user, or your judgment.",
  );

const tabId = z
  .number()
  .int()
  .optional()
  .describe("Defaults to the application tab (Workday or Oracle) of the active posting.");

/**
 * Application form tools (Workday and Oracle Recruiting Cloud). Logging, status moves, tab choice and the posting check live in FormsService; a result
 * carries `postingMismatch` when the tab is another posting's (other tenant or requisition; calls that change the
 * page are refused with `posting_mismatch`), and
 * `tabHidden` when the application tab is still hidden after being brought to the front (the browser throttles it).
 */
export function registerFormTools(server: McpServer, s: Services): void {
  server.registerTool(
    "get_form",
    {
      title: "Read application page",
      description:
        "Read the current application page (Workday or Oracle Recruiting Cloud; `adapter` says which): pageKind " +
        "(posting, auth, start-choice, step, review, confirmation), step, " +
        "and fields by section (id, label, kind, current value, options, error, profile hint; `required` only when " +
        "true; dropdowns and typeaheads list options on demand). Also add buttons with their section, removable " +
        "rows, page actions, errors, `messages` (notices such as upload confirmations, not errors), and " +
        "`posting` (the posting this is credited to). Call at the start of every step and after changes. " +
        "`timingIssues`: mistakes in the user's autofill-timing.yaml (defaults used for those); tell the user. " +
        "`tabHidden` (here and on other form tools): the application tab is hidden and runs slowly; pass its hint " +
        "to the user once. " +
        "On the review page, `notAttached`: approved documents never attached.",
      inputSchema: {
        onlyEmpty: z.boolean().optional().describe("Only fields that are empty or show an error."),
        section: z.string().optional().describe("Only sections whose id or title contains this."),
        tabId,
      },
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "get_form", (args: { onlyEmpty?: boolean; section?: string; tabId?: number }) => s.forms.getForm(args)),
  );

  server.registerTool(
    "autofill_step",
    {
      title: "Autofill the step",
      description:
        "Start every application step with this instead of get_form. It fills, without you, what profile.yaml and " +
        "answers.yaml decide (profile fields the page marks, outside work and education rows; questions whose " +
        "wording equals an answers.yaml entry with a plain answer), then returns: `filled` (each field, value and " +
        "rule; `was` = a value it replaced, left from a previous application), `failed` (fills that didn't take, " +
        "or `inexact`: the page holds a near match, so set the right option), `kept` (fields already right), and " +
        "the step as get_form shows it with only the fields left to decide, each with its `reason`. Check " +
        "`filled` for anything wrong, fix `failed`, then fill the rest in one fill_fields call. On a page that " +
        "isn't an application step, or another posting's tab, it fills nothing and says why in `note`.",
      inputSchema: { tabId },
    },
    tool(s.log, "autofill_step", ({ tabId }: { tabId?: number }) => s.forms.autofillStep(tabId)),
  );

  server.registerTool(
    "list_options",
    {
      title: "List field options",
      description:
        "List the options of dropdowns or typeaheads (for typeahead, the top level; options with hasChildren " +
        "open a sub-menu, so select them with a path like 'Job Board > LinkedIn'). Pass every field you need " +
        "on the step as fieldIds in one call: the result maps each id to its options. Not needed before " +
        "fill_fields: a value that matches nothing returns the options.",
      inputSchema: {
        fieldId: z.string().optional().describe("One field; returns its options as a list."),
        fieldIds: z.array(z.string()).min(1).optional().describe("Several fields; returns { fieldId: options }."),
        tabId,
      },
      annotations: { readOnlyHint: true },
    },
    tool(
      s.log,
      "list_options",
      async ({ fieldId, fieldIds, tabId }: { fieldId?: string; fieldIds?: string[]; tabId?: number }) => {
        if (fieldIds) return s.forms.listOptionsMany(fieldId ? [fieldId, ...fieldIds] : fieldIds, tabId);
        if (fieldId) return s.forms.listOptions(fieldId, tabId);
        throw new EzError(ErrorCode.BadRequest, "Give fieldIds (or one fieldId).");
      },
    ),
  );

  server.registerTool(
    "search_options",
    {
      title: "Search typeahead",
      description:
        "Type a query into a typeahead field (school, field of study, source…) or, on Oracle pages, a dropdown (long " +
        "lists such as countries and cities search as you type), and return matching options.",
      inputSchema: { fieldId: z.string(), query: z.string().min(1), tabId },
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "search_options", ({ fieldId, query, tabId }: { fieldId: string; query: string; tabId?: number }) =>
      s.forms.searchOptions(fieldId, query, tabId),
    ),
  );

  server.registerTool(
    "fill_fields",
    {
      title: "Fill fields",
      description:
        "Fill fields on the current step. Values: text; the option text for dropdowns and radios (closest match; " +
        '"Python" finds "Python (Programming Language)"); a string or array for typeaheads ("Category > Item" ' +
        "for nested menus; each entry is matched on its own); true/false for a checkbox; labels for checkbox " +
        'groups; "YYYY-MM-DD", "YYYY-MM" or "YYYY" for dates. Fill the whole step in one call. Returns ' +
        "`results` per field: { fieldId, ok: true } when the field reads back exactly the value; else the " +
        "read-back, error, options when nothing matched, `unmatched` (typeahead entries with the options their " +
        "search showed) and `inexact` (an option the page chose itself: check it). Never passwords, or EEO " +
        "answers the user hasn't given.",
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
      ({
        fills,
        tabId,
      }: {
        fills: { fieldId: string; value: z.infer<typeof FillValue>; source: FillSource; answerId?: string }[];
        tabId?: number;
      }) => s.forms.fill(fills, tabId),
    ),
  );

  server.registerTool(
    "upload_file",
    {
      title: "Attach a file",
      description:
        "Upload a file from postings/ or library/ (usually the tailored resume.pdf, cover.pdf or a bundle) into a " +
        "file field. Confirms by reading back the newly shown file name. If the field still holds files from a " +
        "previous application (get_form shows them as its value), remove them with remove_items first. " +
        "`notAttached`: documents the user approved for this posting that no upload has attached yet; a field " +
        "with multiple: true (Workday's Resume/CV) takes them too.",
      inputSchema: { fieldId: z.string(), path: z.string().describe("Workspace-relative or absolute path."), tabId },
    },
    tool(s.log, "upload_file", ({ fieldId, path, tabId }: { fieldId: string; path: string; tabId?: number }) =>
      s.forms.upload(fieldId, path, tabId),
    ),
  );

  server.registerTool(
    "remove_items",
    {
      title: "Remove selections or attachments",
      description:
        "Remove entries from a multi-select (kind typeahead, e.g. Skills; on Oracle a checkbox-group) or attached " +
        "files from a file field. Workday and Oracle pre-fill both from the user's last application or profile: " +
        "remove what doesn't belong before uploading or " +
        "filling. values: labels or file names as get_form shows them; omit to clear the field. Returns removed, " +
        "remaining, notFound.",
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
      ({ fieldId, values, reason, tabId }: { fieldId: string; values?: string[]; reason?: string; tabId?: number }) =>
        s.forms.remove(fieldId, values, reason, tabId),
    ),
  );

  server.registerTool(
    "add_repeatable",
    {
      title: "Add a repeatable row",
      description:
        "Press an add button from get_form.addButtons (each names its `section`, e.g. add.work-experience, " +
        "add.websites), then call get_form again. On Oracle an add button opens an inline form: fill it, then " +
        "press its save.<section> button the same way, which adds the item (an error says what the page wants).",
      inputSchema: { addButtonId: z.string(), tabId },
    },
    tool(s.log, "add_repeatable", ({ addButtonId, tabId }: { addButtonId: string; tabId?: number }) =>
      s.forms.addRepeatable(addButtonId, tabId),
    ),
  );

  server.registerTool(
    "remove_repeatable",
    {
      title: "Remove a repeatable row",
      description:
        "Delete a repeatable row, by the id of a section get_form marks `removable` (e.g. a Work Experience entry " +
        "carried over from the user's last application that the profile doesn't have; on Oracle a saved item " +
        "such as a language or a timeline entry). Field ids of later rows change afterwards: call get_form again.",
      inputSchema: {
        sectionId: z.string(),
        reason: z.string().optional().describe("Why, for the log, e.g. 'not in the profile'."),
        tabId,
      },
    },
    tool(
      s.log,
      "remove_repeatable",
      ({ sectionId, reason, tabId }: { sectionId: string; reason?: string; tabId?: number }) =>
        s.forms.removeRepeatable(sectionId, reason, tabId),
    ),
  );

  server.registerTool(
    "go_next",
    {
      title: "Next step",
      description:
        "Press Next / Save and Continue. Refuses on the review page and on any Submit button: the user always " +
        "submits (Oracle's single-page applications have only Submit: fill every section, then hand over). Returns whether the step advanced (its index, title or page kind changed), the new " +
        "pageKind/step, validation errors if it did not, and notices such as upload confirmations as `messages`. " +
        "Returns once the new step shows its fields. At the review page, `notAttached` lists approved documents " +
        "never attached: go back and attach them before handing off.",
      inputSchema: { tabId },
    },
    tool(s.log, "go_next", ({ tabId }: { tabId?: number }) => s.forms.next(tabId)),
  );

  server.registerTool(
    "go_back",
    {
      title: "Previous step",
      description:
        "Press Back to the previous step (get_form shows backLabel when there is one), e.g. to correct an answer " +
        "from the review page, then get_form. Entries on the current step that weren't saved with go_next may " +
        "be lost: check them when coming forward again.",
      inputSchema: { tabId },
    },
    tool(s.log, "go_back", ({ tabId }: { tabId?: number }) => s.forms.back(tabId)),
  );

  server.registerTool(
    "page_action",
    {
      title: "Start-page action",
      description:
        "On a posting or start-choice page: apply (the Apply button), apply_manually (preferred), " +
        "autofill_with_resume, or use_last_application (on Oracle: Use My Profile, for a returning candidate).",
      inputSchema: { action: PageAction, tabId },
    },
    tool(s.log, "page_action", ({ action, tabId }: { action: z.infer<typeof PageAction>; tabId?: number }) =>
      s.forms.pageAction(action, tabId),
    ),
  );

  server.registerTool(
    "screenshot",
    {
      title: "Screenshot tab",
      description:
        "Last resort only. Capture the visible part of the application tab as an image, when get_form (with its " +
        "errors and messages) and browser_status leave a page or widget unexplained and you are about to hand the " +
        "problem to the user. Never to read or check fields: get_form does that. The image is re-sent with every " +
        "later turn, and only the tab on screen can be captured.",
      inputSchema: { tabId },
      annotations: { readOnlyHint: true },
    },
    rawTool(s.log, "screenshot", async ({ tabId }: { tabId?: number }) => {
      const r = await s.forms.screenshot(tabId);
      return {
        content: [
          { type: "image", data: r.pngBase64, mimeType: "image/png" },
          { type: "text", text: JSON.stringify({ tabId: r.tabId }) },
        ],
      };
    }),
  );
}

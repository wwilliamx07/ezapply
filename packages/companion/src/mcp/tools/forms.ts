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
  .describe("Defaults to the application tab (on any supported site) of the active posting.");

/**
 * Application form tools, for every site in the registry. Logging, status moves, tab choice and the posting check
 * live in FormsService; a result carries `postingMismatch` when the tab is another posting's (other tenant or
 * requisition; calls that change the page are refused with `posting_mismatch`), and `tabHidden` when the
 * application tab is still hidden after being brought to the front (the browser throttles it).
 *
 * The descriptions never name a site: every Claude session reads them, whichever site it fills. What a site does
 * differently reaches the agent as `siteNotes`, on the first read of that site's page in the session (`session`:
 * the chat session the request came from).
 */
export function registerFormTools(server: McpServer, s: Services, session?: string): void {
  server.registerTool(
    "get_form",
    {
      title: "Read application page",
      description:
        "Read the current application page (`adapter` names its site): pageKind " +
        "(posting, auth, start-choice, step, review, confirmation), step, " +
        "and fields by section (id, label, kind, current value, options, error, profile hint; `required` only when " +
        "true; dropdowns and typeaheads list options on demand; a list too long to send gives `optionCount`, and " +
        "fill_fields still matches its options). Also add buttons with their section, removable " +
        "rows, page actions, errors, `messages` (notices such as upload confirmations, not errors), and " +
        "`posting` (the posting this is credited to). Call at the start of every step and after changes. " +
        "`timingIssues`: mistakes in the user's autofill-timing.yaml (defaults used for those); tell the user. " +
        "`tabHidden` (here and on other form tools): the application tab is hidden and runs slowly; pass its hint " +
        "to the user once. " +
        "On the review page, `notAttached`: approved documents never attached. `siteNotes` (the first time a " +
        "site's page is read in this session): what this site does differently; " +
        "follow them for this application.",
      inputSchema: {
        onlyEmpty: z.boolean().optional().describe("Only fields that are empty or show an error."),
        section: z.string().optional().describe("Only sections whose id or title contains this."),
        tabId,
      },
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "get_form", (args: { onlyEmpty?: boolean; section?: string; tabId?: number }) =>
      s.forms.getForm({ ...args, session }),
    ),
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
        "Type a query into a typeahead (school, field of study, source…) or a dropdown whose long list searches as " +
        "you type (countries, cities), and return matching options. A field that can't be searched says so.",
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
        "with multiple: true takes them too, even when it's the only file field.",
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
        "Remove entries from a multi-select (a typeahead such as Skills, or a checkbox-group) or attached files " +
        "from a file field. A site may pre-fill both from the user's last application or profile: remove what " +
        "doesn't belong before uploading or filling. values: labels or file names as get_form shows them; omit to clear the field. Returns removed, " +
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
        "Press buttons from get_form.addButtons (each names its `section`), in order: every row a step needs in " +
        "one call, repeating an id for another row. Returns `pressed`, `failed` (the button that failed and why; " +
        "the ones after it weren't pressed) and `form`: the step's empty fields as get_form gives them, so the new " +
        "rows can be filled without another get_form. A button's `kind` says what it does: `row` adds a row of " +
        "fields; `form` opens an inline form: fill it, then press its `save` button the same way, which adds the " +
        "item (an error says what the page wants); `save` also saves a form that is part of the page; `edit` opens " +
        "a saved item's form again.",
      inputSchema: {
        addButtonId: z.string().optional().describe("One button."),
        addButtonIds: z.array(z.string()).min(1).optional().describe("Several presses, in order."),
        tabId,
      },
    },
    tool(
      s.log,
      "add_repeatable",
      ({ addButtonId, addButtonIds, tabId }: { addButtonId?: string; addButtonIds?: string[]; tabId?: number }) => {
        const ids = addButtonIds ?? (addButtonId ? [addButtonId] : []);
        if (ids.length === 0) throw new EzError(ErrorCode.BadRequest, "Give addButtonId or addButtonIds.");
        return s.forms.addRepeatable(ids, tabId, session);
      },
    ),
  );

  server.registerTool(
    "remove_repeatable",
    {
      title: "Remove a repeatable row",
      description:
        "Delete a repeatable row or saved item, by the id of a section get_form marks `removable` (e.g. a work " +
        "entry carried over from the user's last application that the profile doesn't have). Field ids of later " +
        "rows change afterwards: the result's `form` is the step as get_form gives it, with the new ids.",
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
        s.forms.removeRepeatable(sectionId, reason, tabId, session),
    ),
  );

  server.registerTool(
    "go_next",
    {
      title: "Next step",
      description:
        "Press Next / Save and Continue. Refuses on the review page and on any Submit button: the user always " +
        "submits (with `lastPage` in get_form, Submit is the only way on: fill every field, then hand over). " +
        "Returns whether the step advanced (its index, title or page kind changed), `checklist` (what still looked " +
        "off on the step just left), and notices such as upload confirmations as `messages`. Advanced: `form` is " +
        "the new page as get_form gives it, once it shows its fields (no get_form needed); at the review page its " +
        "`notAttached` lists approved documents never attached: go back and attach them before handing off. Not " +
        "advanced: the page's pageKind/step and the validation errors.",
      inputSchema: { tabId },
    },
    tool(s.log, "go_next", ({ tabId }: { tabId?: number }) => s.forms.next(tabId, session)),
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
        "autofill_with_resume, or use_last_application (the candidate's last application or profile on the site).",
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

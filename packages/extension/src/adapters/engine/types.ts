import type {
  Field,
  FieldKind,
  FillResult,
  FillValue,
  FormSchema,
  OptionInfo,
  PageAction,
  PageKind,
} from "@ezapply/protocol";
import type { SiteInfo } from "@ezapply/protocol/sites";

/**
 * What a site is, for the engine: where its buttons are, what kinds of fields it has (its widget drivers), where
 * each field and its prompt are, and how its rows, items and pages behave. One definition per site in
 * `adapters/sites/<site>/site.ts`; the engine (`api.ts`, `extract.ts`) does the rest the same way for every site.
 */
export interface SiteDefinition {
  /** The registry entry: id, tenant, and the site's own waits. */
  info: SiteInfo;
  /**
   * The site's widgets. A field whose spot names no driver gets the first one that recognises its container, so
   * order matters: the more specific first.
   */
  widgets: readonly WidgetDriver[];
  /** Every field on the page, in page order. */
  fields(doc: Document): FieldSpot[];
  /** The add buttons (and inline forms' Save buttons) on the page. */
  addButtons(doc: Document): AddButtonSpot[];
  /** Rows the page can delete, and saved items (summaries without fields), by the sections extraction found. */
  rows(doc: Document, sections: ReadonlyMap<string, SectionSpot>): RowSpot[];
  page: PageRules;
  /** How rows and items are added and removed. */
  repeat: RepeatRules;
  fill: FillRules;
  /**
   * The site owns its waits: the engine waits only through these (and for its conditions, as long as the site's
   * registry entry says: `T.stepMs`, `T.addRowMs`…). The loop itself never sleeps.
   */
  waits: SiteWaits;
  /** What the engine says when it refuses or can't find something, in the site's own words. */
  messages: Messages;
}

export interface PageRules {
  /** The page kind: posting, auth, start-choice, step, review, confirmation, unknown. */
  kind(doc: Document, url: string, fieldCount: number): PageKind;
  step(doc: Document): FormSchema["step"];
  /** What changes when the page moves to another step (a step index and title, or the URL). */
  stepKey(doc: Document, url: string): string;
  errors(doc: Document): string[];
  /** Notices in the page's alert regions that aren't errors ("resume.pdf successfully uploaded"). */
  messages(doc: Document): string[];
  actions(doc: Document): PageAction[];
  actionButton(doc: Document, action: PageAction): HTMLElement | null;
  next(doc: Document): HTMLElement | null;
  /**
   * Why Next can't go on from the page as it is, checked before pressing it: a requirement the page enforces with a
   * native dialog (`alert`), which would stop the page, and the adapter's call with it, until the user dismissed it.
   */
  nextBlocked?(doc: Document): string | undefined;
  back(doc: Document): HTMLElement | null;
  /** A button's label as the schema shows it (`nextLabel`, `backLabel`). */
  label(button: HTMLElement): string;
  /** A control that submits the application: never pressed, and blocked by the submit guard. */
  isSubmit(el: Element | null): boolean;
  /**
   * The job the page says it's the application for: the title in its header, a requisition shown on it
   * (`FormSchema.job`). The companion uses it to tell which posting a tab belongs to when its URL can't say. Left
   * out by a site whose application pages don't show the job.
   */
  job?(doc: Document): FormSchema["job"];
}

export interface RepeatRules {
  /** What a deletable thing is called in messages: "row", "item". */
  noun: string;
  /** Counts what an add makes more of (field containers, rows), to see an add take. */
  added(doc: Document): number;
  /** Counts what a removal makes fewer of, to see it take. */
  removed(doc: Document): number;
  /** The row's delete button, revealing it first where the site hides it (hover). */
  deleteButton(row: RowSpot): Promise<HTMLElement | null>;
  /** Presses the confirm button of a delete confirmation, if one is showing. */
  confirmRemoval(doc: Document): Promise<void>;
  /** An inline form's Save (`save.*`): where its errors show, to tell a refused Save from a slow one. */
  saveErrors?(button: HTMLElement): number;
}

export interface FillRules {
  /** "page": fill in page order whatever order the fills came in (dependent lists). Default: as given. */
  order?: "given" | "page";
  /** Wait for "required" errors that linger a moment after a field is filled before reporting them. */
  waitForStaleErrors?: boolean;
  /** Scroll a file field into view before uploading to it. */
  scrollBeforeUpload?: boolean;
  /** `next` ends its wait on errors only when they changed (a page that keeps old errors on screen). */
  newErrorsOnly?: boolean;
}

export interface SiteWaits {
  /** After each field is filled, before the next. */
  afterField(doc: Document): Promise<void>;
  /** After a row was added or removed, or an inline form saved. */
  afterRow(doc: Document): Promise<void>;
  /** After `next` or `back` pressed: `moved` when the step changed. Before the new step is read. */
  afterStep(doc: Document, moved: boolean): Promise<void>;
  /** After a page action (Apply, Use My Profile). */
  afterAction(doc: Document): Promise<void>;
}

export interface Messages {
  noNextButton: string;
  noBackButton: string;
  /** The forward button is a submit control. */
  submitIsNext(button: HTMLElement): string;
  /** Why `next` won't go on from this kind of page, if it won't. */
  refuseNext(kind: PageKind): string | undefined;
  noSearch: string;
  cantRemove(kind: FieldKind): string;
}

/** One field the site found on the page. */
export interface FieldSpot {
  /** What its driver acts on. */
  container: HTMLElement;
  /** The driver for it, when the site decides; else the first of the site's drivers that recognises it. */
  driver?: WidgetDriver;
  /** The id's part after the section (`legalName--firstName`); the engine adds `#n` to repeats. */
  key: string;
  /** The prompt: the question as the page asks it. */
  label: string;
  /** The heading it sits under: the section's title, whose slug is the section id. */
  section: string;
  required: boolean;
  automationId?: string;
  help?: string;
  error?: string;
  /** A profile path the value is known to come from (`identity.firstName`). */
  hint?: string;
}

export interface SectionSpot {
  title: string;
  /** The container of its first field. */
  first: HTMLElement;
}

/** A row the page can delete (Workday's "Work Experience 2"), or a saved item shown without fields. */
export interface RowSpot {
  /** The section it is: an existing one (a row of fields), or a new one for a saved item. */
  sectionId: string;
  /** The row's own name, as removal reports it ("French, Fluent"). */
  title: string;
  /** A saved item's section title, when it differs from `title` ("Languages: French, Fluent"). */
  sectionTitle?: string;
  el: HTMLElement;
  /** A saved item: a section of its own with no fields (Oracle's tiles and timeline entries). */
  saved?: boolean;
  /** The delete button, when the site found it while extracting. */
  button?: HTMLElement;
}

export interface AddButtonSpot {
  el: HTMLElement;
  /** The id before any `#n`: `add.work-experience`, `save.languages`. */
  key: string;
  label: string;
  section?: string;
  kind: "row" | "form" | "save";
}

export type FillOutcome = Omit<FillResult, "fieldId">;

export interface RemoveOutcome {
  ok: boolean;
  removed: string[];
  remaining: string[];
  notFound?: string[];
  error?: string;
}

/** One kind of widget on a site: how to recognise it, read it, fill it, and list, search or clear it. */
export interface WidgetDriver {
  kind: FieldKind;
  /** This field container holds this widget. */
  is(c: HTMLElement): boolean;
  value(c: HTMLElement): Field["currentValue"];
  /** Options the page shows up front (radios, pills). */
  options?(c: HTMLElement): string[] | undefined;
  /** Options appear only when the widget is opened or searched (`list_options`). */
  lazyOptions?: boolean;
  dateParts?(c: HTMLElement): Field["dateParts"];
  /** Whether it takes several values; undefined leaves `multiple` off the field. */
  multiple?(c: HTMLElement): boolean | undefined;
  fill(c: HTMLElement, value: FillValue, opts: { strict: boolean }): Promise<FillOutcome>;
  list?(c: HTMLElement): Promise<OptionInfo[]>;
  search?(c: HTMLElement, query: string): Promise<OptionInfo[]>;
  remove?(c: HTMLElement, values: string[] | null | undefined, field: Field): Promise<RemoveOutcome>;
  upload?(c: HTMLElement, file: File): Promise<FillOutcome>;
}

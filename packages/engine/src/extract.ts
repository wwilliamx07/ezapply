import type { Field, FormSchema, Section } from "@ezapply/protocol";
import { slug } from "./dom.js";
import type { FieldSpot, RowSpot, SectionSpot, SiteDefinition, WidgetDriver } from "./types.js";

export type PageSchema = Omit<FormSchema, "tabId">;

/** A field on the page as the engine keeps it between calls: the schema's field and what fills it. */
export interface FieldRef {
  field: Field;
  container: HTMLElement;
  driver: WidgetDriver;
}

export interface Extraction {
  schema: PageSchema;
  fields: Map<string, FieldRef>;
  addButtons: Map<string, HTMLElement>;
  /** Deletable rows and saved items, by section id. */
  rows: Map<string, RowSpot>;
}

/** The driver a spot names, else the first of the site's that recognises its container. */
function driverFor(site: SiteDefinition, spot: Pick<FieldSpot, "container" | "driver">): WidgetDriver | undefined {
  return spot.driver ?? site.widgets.find((w) => w.is(spot.container));
}

/**
 * Read the page as a `FormSchema`, the same way for every site: the site says where its fields, prompts, buttons
 * and rows are (`SiteDefinition`); the engine gives each field its id (`<section slug>.<key>`, `#n` for repeats),
 * its kind and value from its driver, groups fields into sections in page order, marks rows removable, and names
 * add buttons uniquely.
 */
export function extract(site: SiteDefinition, doc: Document, url: string): Extraction {
  const fields = new Map<string, FieldRef>();
  const sections = new Map<string, Section>();
  const firsts = new Map<string, SectionSpot>();
  const repeats = new Map<string, number>();

  for (const spot of site.fields(doc)) {
    const driver = driverFor(site, spot);
    if (!driver) continue;
    const c = spot.container;
    const sectionId = slug(spot.section);
    let id = `${sectionId}.${spot.key}`;
    const seen = repeats.get(id) ?? 0;
    repeats.set(id, seen + 1);
    if (seen > 0) id = `${id}#${seen + 1}`;

    const field: Field = {
      id,
      ...(spot.automationId ? { automationId: spot.automationId } : {}),
      label: spot.label,
      required: spot.required,
      kind: driver.kind,
      currentValue: driver.value(c),
    };
    if (spot.help) field.helpText = spot.help;
    const options = driver.options?.(c);
    if (options) field.options = options;
    if (driver.lazyOptions) field.optionsLazy = true;
    const dateParts = driver.dateParts?.(c);
    if (dateParts) field.dateParts = dateParts;
    const multiple = driver.multiple?.(c);
    if (multiple !== undefined) field.multiple = multiple;
    if (spot.error) field.error = spot.error;
    if (spot.hint) field.hint = { profileKey: spot.hint };

    fields.set(id, { field, container: c, driver });
    const section = sections.get(sectionId) ?? { id: sectionId, title: spot.section, fields: [] };
    section.fields.push(field);
    sections.set(sectionId, section);
    if (!firsts.has(sectionId)) firsts.set(sectionId, { title: spot.section, first: c });
  }

  const rows = new Map<string, RowSpot>();
  for (const row of site.rows(doc, firsts)) {
    rows.set(row.sectionId, row);
    const existing = sections.get(row.sectionId);
    if (existing && !row.saved) existing.removable = true;
    else {
      const title = row.sectionTitle ?? row.title;
      sections.set(row.sectionId, { id: row.sectionId, title, fields: [], removable: true, saved: true });
    }
  }

  const addButtons = new Map<string, HTMLElement>();
  const addInfo: FormSchema["addButtons"] = [];
  for (const b of site.addButtons(doc)) {
    let id = b.key;
    for (let n = 2; addButtons.has(id); n++) id = `${b.key}#${n}`;
    addButtons.set(id, b.el);
    addInfo.push({ id, label: b.label, ...(b.section ? { section: b.section } : {}), kind: b.kind });
  }

  const pageKind = site.page.kind(doc, url, fields.size);
  const next = site.page.next(doc);
  const back = site.page.back(doc);
  const step = site.page.step(doc);
  const messages = site.page.messages(doc);
  const tenant = site.info.tenant(url);
  const job = site.page.job?.(doc);
  const schema: PageSchema = {
    adapter: site.info.id,
    url,
    ...(tenant ? { tenant } : {}),
    pageKind,
    ...(step ? { step } : {}),
    sections: [...sections.values()],
    addButtons: addInfo,
    actions: site.page.actions(doc),
    errors: site.page.errors(doc),
    ...(messages.length ? { messages } : {}),
    ...(next ? { nextLabel: site.page.label(next) } : {}),
    ...(pageKind === "step" && next && site.page.isSubmit(next) ? { lastPage: true } : {}),
    ...(back ? { backLabel: site.page.label(back) } : {}),
    ...(job?.title || job?.reqId ? { job } : {}),
  };
  return { schema, fields, addButtons, rows };
}

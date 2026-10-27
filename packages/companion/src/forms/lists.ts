import type { Field, FormSchema, Section } from "@ezapply/protocol";
import type { Profile } from "../profile/schema.js";

/**
 * The profile's lists that repeatable parts of a form are filled from (work rows, education rows, language rows,
 * links), and how a section or an add button is matched to one: by its title, a heuristic. Used by the hand-off
 * checklist to compare each list's rows on the page with the profile's entries.
 */

type ListKey = "work" | "education" | "languages" | "certifications" | "links";

export const LISTS: { key: ListKey; title: RegExp; name: string }[] = [
  { key: "work", title: /work|employment|experience/i, name: "work entries" },
  { key: "education", title: /education/i, name: "education entries" },
  { key: "languages", title: /language/i, name: "languages" },
  { key: "certifications", title: /certif|licen/i, name: "certifications" },
  { key: "links", title: /website|link|social|url/i, name: "links besides LinkedIn" },
];

function listOf(title: string): ListKey | undefined {
  return LISTS.find((l) => l.title.test(title))?.key;
}

/**
 * The list an add button adds to: by its label first ("Add Experience", "Add Language" on Oracle), then the
 * section it sits under (Workday labels every add button "Add" or "Add Another"). An inline form's Save (`save`)
 * adds nothing by itself, nor does an `edit` button, which opens a saved item's form again.
 */
export function listOfButton(b: FormSchema["addButtons"][number]): ListKey | undefined {
  if (b.kind === "save" || b.kind === "edit" || b.id.startsWith("save.")) return undefined;
  return listOf(b.label) ?? (b.section ? listOf(b.section) : undefined);
}

/**
 * A repeatable row: Workday's sections `work-experience-2`, `education-1`, `languages-3`, `websites-1`, titled
 * like "Work Experience 2". Oracle's saved items (`languages.item-1`) aren't rows: see `savedItemOf`.
 */
function rowOf(s: Section): ListKey | undefined {
  if (!/^[^.]+-\d+$/.test(s.id)) return undefined;
  return listOf(s.title.replace(/\s+\d+$/, ""));
}

/**
 * Oracle's saved items, sections with no fields: `work-and-education-history.experience-1` (work) and
 * `….education-1` on the timeline, `languages.item-1` "Languages: French, Fluent" (the list of its block).
 */
function savedItemOf(s: Section): ListKey | undefined {
  const kind = /\.([a-z]+)-\d+$/.exec(s.id)?.[1];
  if (!kind || !s.saved) return undefined;
  if (kind === "experience") return "work";
  if (kind === "education") return "education";
  return listOf(s.title.split(":")[0] ?? "");
}

/**
 * A text field that holds one link, outside a row: Oracle's "Link 1", "Link 2" under Resume and URLs. Narrow on
 * purpose: a "Facebook" or "Twitter" field elsewhere isn't one.
 */
function isLinkSlot(f: Field): boolean {
  return f.kind === "text" && !f.hint && /^(link|url|website|web site|portfolio)\s*\d*$/i.test(f.label.trim());
}

/** The rows, saved items and link fields each list has on the page, in page order. */
export function listSlots(form: FormSchema): Map<ListKey, { section: Section; field?: Field }[]> {
  const out = new Map<ListKey, { section: Section; field?: Field }[]>();
  const add = (list: ListKey, slot: { section: Section; field?: Field }) =>
    out.set(list, [...(out.get(list) ?? []), slot]);
  for (const section of form.sections) {
    const list = rowOf(section) ?? savedItemOf(section);
    if (list) {
      add(list, { section });
      continue;
    }
    for (const field of section.fields) if (isLinkSlot(field)) add("links", { section, field });
  }
  return out;
}

/**
 * How many entries the profile has for a list on this page. Links count LinkedIn only when the page has no
 * LinkedIn field of its own (Workday has one; Oracle has only "Link 1", "Link 2"…).
 */
export function profileCount(p: Profile, key: ListKey, form?: FormSchema): number {
  if (key === "links") return profileLinks(p, form ? !hasLinkedInField(form) : false).length;
  return p[key].length;
}

/** The page has a field for the LinkedIn profile (hinted `links.linkedin`), so link rows hold the other links. */
export function hasLinkedInField(form: FormSchema): boolean {
  return form.sections.some((s) => s.fields.some((f) => f.hint?.profileKey === "links.linkedin"));
}

/** The profile's links in the order they go into link rows: LinkedIn (when asked for), GitHub, portfolio, others. */
function profileLinks(p: Profile, withLinkedIn: boolean): string[] {
  return [
    ...(withLinkedIn && p.links.linkedin ? [p.links.linkedin] : []),
    ...(p.links.github ? [p.links.github] : []),
    ...(p.links.portfolio ? [p.links.portfolio] : []),
    ...p.links.other.map((o) => o.url),
  ];
}

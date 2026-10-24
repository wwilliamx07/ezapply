import type { BackResult, Field, FormSchema, NextResult, OptionInfo, PageAction } from "@ezapply/protocol";
import type { CloneDescription } from "@ezapply/sites/clones";
import type { Adapter, Recorder } from "../lib/browser.ts";
import { PLACEHOLDER_PDF, placeholder, type ValueSet } from "../lib/profile.ts";

type Schema = Omit<FormSchema, "tabId">;

/** What the explorer reached, for the clone's report. */
export interface Coverage {
  steps: string[];
  /** Every field seen, and whether it was filled or chosen at least once. */
  fields: { id: string; kind: string; touched: boolean }[];
  /** Lists opened, with how many options they held. */
  lists: { id: string; options: number }[];
  /** Search boxes: how many results the queries found in all, and whether the last round found nothing new. */
  searches: { id: string; size: number; queries: number; stable: boolean; rule?: string }[];
  /** Answers that opened fields, and how many. */
  sections: { field: string; answer: string; opened: number }[];
  /** The site's own refusals seen: Next with required fields empty, or with a bad value. */
  refusals: { step: string; errors: string[] }[];
  rows: { button: string; added: boolean; removed: boolean }[];
  /** What the explorer couldn't do: for the site's description or hooks to fix. */
  notes: string[];
}

interface ExploreOptions {
  adapter: Adapter;
  recorder: Recorder;
  quiet: () => Promise<void>;
  desc?: CloneDescription;
  /** `explore`: every list, search, answer and refusal. `path`: one way through with the given values (held out). */
  mode: "explore" | "path";
  set: ValueSet;
  log: (line: string) => void;
  /** Called while the page asks for a sign-in: resolves when the user may have signed in. */
  waitForSignIn?: () => Promise<void>;
  /** Searches tried per search box at most (default 400). */
  maxQueries?: number;
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const MAX_STEPS = 25;
const TEXTS = new Set(["text", "textarea", "number", "date"]);
const CHOICES = new Set(["dropdown", "typeahead", "radio", "checkbox-group"]);
const handOff = (f: Schema) => f.pageKind === "review" || f.pageKind === "confirmation" || !!f.lastPage;
const stepName = (f: Schema) => f.step?.title ?? f.pageKind;

/**
 * Explores an application through its site's adapter, the way the agent would fill it but trying everything: every
 * list opened, every search box searched until nothing new comes back, every answer that opens a section picked in
 * turn, Next pressed empty and with a bad value, a row added and removed, Back and forward. It reads the page only
 * through `get_form`'s facts, so it works on any site with an adapter. It never presses Submit: it stops at the
 * hand-off (a review page, or a last page whose only way on is Submit), and the adapter refuses Submit anyway.
 */
export async function explore(o: ExploreOptions): Promise<Coverage> {
  const cov: Coverage = {
    steps: [],
    fields: [],
    lists: [],
    searches: [],
    sections: [],
    refusals: [],
    rows: [],
    notes: [],
  };
  const touched = new Set<string>();
  /** Fields seen and left alone (a file the site would send on attaching): not touched, not tried again. */
  const passed = new Set<string>();
  const kinds = new Map<string, string>();
  const maxAnswers = o.desc?.explorer?.maxAnswers ?? 12;

  const act = async <T>(action: string, method: string, ...args: unknown[]): Promise<T | undefined> => {
    o.recorder.action = action;
    try {
      return await o.adapter.call<T>(method, ...args);
    } catch (err) {
      cov.notes.push(`${action}: ${(err as Error).message}`);
      return undefined;
    } finally {
      await o.quiet();
    }
  };
  const get = async (): Promise<Schema> => {
    const f = await act<Schema>("read", "getForm");
    if (!f) throw new Error(`get_form failed: ${cov.notes.at(-1)}`);
    for (const s of f.sections) for (const x of s.fields) kinds.set(x.id, x.kind);
    return f;
  };
  const fieldsOf = (f: Schema) => f.sections.flatMap((s) => s.fields);

  /** Fills one field, and in explore mode tries what it can do first. */
  const handle = async (field: Field, depth: number): Promise<void> => {
    if (field.kind === "file" && !o.desc?.explorer?.uploads) {
      passed.add(field.id);
      cov.notes.push(`${field.id}: no file attached (the site sends files on attaching, or isn't known to keep them)`);
      return;
    }
    touched.add(field.id);
    if (TEXTS.has(field.kind)) {
      const value = placeholder(field, o.set);
      await act(`type ${field.id} ${value}`, "fill", [{ fieldId: field.id, value }]);
      return;
    }
    if (field.kind === "checkbox") {
      if (o.mode === "explore") await tryAnswer(field, true, depth);
      await act(`choose ${field.id} true`, "fill", [{ fieldId: field.id, value: true }]);
      return;
    }
    if (field.kind === "file") {
      await act(`upload ${field.id}`, "upload", field.id, PLACEHOLDER_PDF);
      return;
    }
    if (!CHOICES.has(field.kind)) return;
    let options = field.options ?? [];
    if (!options.length || field.optionsLazy) options = await optionsOf(field);
    if (!options.length) {
      cov.notes.push(`${field.id}: no options found`);
      return;
    }
    if (o.mode === "explore") {
      for (const answer of options.slice(0, maxAnswers)) await tryAnswer(field, answer, depth);
    }
    const answer = o.set === "first" ? options[0] : (options[1] ?? options[0]);
    await act(`choose ${field.id} ${answer}`, "fill", [
      { fieldId: field.id, value: field.multiple ? [answer] : answer },
    ]);
  };

  /** Picks an answer and, when it opens fields, fills those before the next answer closes them. */
  const tryAnswer = async (field: Field, answer: string | boolean, depth: number) => {
    const before = new Set(fieldsOf(await get()).map((x) => x.id));
    const value = typeof answer === "string" && field.multiple ? [answer] : answer;
    await act(`choose ${field.id} ${answer}`, "fill", [{ fieldId: field.id, value }]);
    const opened = fieldsOf(await get()).filter((x) => !before.has(x.id));
    if (!opened.length) return;
    cov.sections.push({ field: field.id, answer: String(answer), opened: opened.length });
    if (depth < 2) for (const x of opened) if (!touched.has(x.id) && !passed.has(x.id)) await handle(x, depth + 1);
  };

  /** A choice's options: the list opened, else (a search box) searched until nothing new comes back. */
  const optionsOf = async (field: Field): Promise<string[]> => {
    if (o.mode === "path") {
      const listed = (await act<OptionInfo[]>(`list ${field.id}`, "listOptions", field.id)) ?? [];
      if (listed.length) return listed.map((x) => x.label);
      const q = o.set === "first" ? "a" : "e";
      return ((await act<OptionInfo[]>(`search ${field.id} ${q}`, "searchOptions", field.id, q)) ?? []).map(
        (x) => x.label,
      );
    }
    const listed = (await act<OptionInfo[]>(`list ${field.id}`, "listOptions", field.id)) ?? [];
    if (listed.length && field.kind !== "typeahead") {
      cov.lists.push({ id: field.id, options: listed.length });
      return listed.map((x) => x.label);
    }
    return searchAll(
      field,
      listed.map((x) => x.label),
    );
  };

  const searchAll = async (field: Field, start: string[]): Promise<string[]> => {
    const seen = new Set(start);
    const results: [string, string[]][] = [];
    let queries = 0;
    let pageSize = 0;
    const search = async (q: string) => {
      queries++;
      const r = ((await act<OptionInfo[]>(`search ${field.id} ${q}`, "searchOptions", field.id, q)) ?? []).map(
        (x) => x.label,
      );
      results.push([q, r]);
      pageSize = Math.max(pageSize, r.length);
      let added = 0;
      for (const l of r)
        if (!seen.has(l)) {
          seen.add(l);
          added++;
        }
      return { r, added };
    };
    const all = await search("");
    let level = [...LETTERS];
    let stable = false;
    const max = o.maxQueries ?? 400;
    while (level.length && queries < max) {
      const full: string[] = [];
      let added = 0;
      for (const q of level) {
        if (queries >= max) break;
        const { r, added: a } = await search(q);
        added += a;
        if (r.length && r.length >= pageSize) full.push(q);
      }
      // Every one-letter search came out of what the empty search showed: that was the whole dataset.
      if (level.length === LETTERS.length && all.r.length && added === 0) {
        stable = true;
        break;
      }
      if (!added || !full.length) {
        stable = true;
        break;
      }
      level = full.flatMap((p) => [...LETTERS].map((c) => p + c));
    }
    cov.searches.push({ id: field.id, size: seen.size, queries, stable, ...ruleOf(results) });
    return [...seen];
  };

  const reachForm = async (): Promise<Schema> => {
    for (let i = 0; i < 6; i++) {
      const f = await get();
      if (f.pageKind === "auth") {
        if (!o.waitForSignIn) throw new Error("The site asks for a sign-in.");
        o.log("Sign in in the browser window; the explorer carries on once the application form is on screen.");
        await o.waitForSignIn();
        continue;
      }
      if (f.pageKind !== "posting" && f.pageKind !== "start-choice") return f;
      const action: PageAction | undefined = (["apply_manually", "apply"] as const).find((a) => f.actions.includes(a));
      if (!action) return f;
      await act(`action ${action}`, "pageAction", action);
      await o.adapter.page.waitForLoadState("domcontentloaded").catch(() => {});
      await o.quiet();
    }
    return get();
  };

  let form = await reachForm();
  for (let s = 0; s < MAX_STEPS; s++) {
    const name = stepName(form);
    cov.steps.push(name);
    o.log(`step: ${name} (${fieldsOf(form).length} fields)`);
    if (o.mode === "explore" && form.pageKind === "step" && !handOff(form)) {
      const r = await act<NextResult>(`next ${name} empty`, "next");
      if (r?.errors.length) cov.refusals.push({ step: name, errors: r.errors });
      if (r?.advanced) await act<BackResult>(`back ${name}`, "back");
    }
    for (let i = 0; i < 300; i++) {
      const left = fieldsOf(await get()).filter(
        (x) => !touched.has(x.id) && !passed.has(x.id) && x.kind !== "password",
      );
      const first = left[0];
      if (!first) break;
      await handle(first, 0);
    }
    form = await get();
    if (o.mode === "explore") {
      for (const b of form.addButtons.filter((x) => x.kind === "row")) {
        const before = new Set(form.sections.map((x) => x.id));
        const added = await act<{ ok: boolean }>(`add ${b.id}`, "addRepeatable", b.id);
        const row = (await get()).sections.find((x) => !before.has(x.id) && x.removable);
        const removed = row ? await act<{ ok: boolean }>(`remove ${row.id}`, "removeRepeatable", row.id) : undefined;
        cov.rows.push({ button: b.id, added: !!added?.ok, removed: !!removed?.ok });
      }
      form = await get();
    }
    if (handOff(form)) break;
    if (o.mode === "explore") await badValue(form, name);
    const r = await act<NextResult>(`next ${name}`, "next");
    if (!r?.advanced) {
      cov.notes.push(`Next on "${name}" didn't go on: ${r?.refusedReason ?? r?.errors.join("; ") ?? "no answer"}`);
      break;
    }
    if (o.mode === "explore") {
      const back = await act<BackResult>(`back ${stepName(await get())}`, "back");
      if (back?.moved) await act<NextResult>(`next ${name} again`, "next");
    }
    form = await get();
  }
  const fields = [...kinds].map(([id, kind]) => ({ id, kind, touched: touched.has(id) }));
  return { ...cov, fields };

  /** Next with an email that isn't one, for the site's own refusal; then the good value back. */
  async function badValue(f: Schema, name: string) {
    const email = fieldsOf(f).find((x) => x.hint?.profileKey === "contact.email" || /e-?mail/i.test(x.label));
    if (email?.kind !== "text") return;
    await act(`type ${email.id} not-an-email`, "fill", [{ fieldId: email.id, value: "not-an-email" }]);
    const r = await act<NextResult>(`next ${name} bad`, "next");
    if (r?.errors.length) cov.refusals.push({ step: name, errors: r.errors });
    if (r?.advanced) await act<BackResult>(`back ${name}`, "back");
    const value = placeholder(email, o.set);
    await act(`type ${email.id} ${value}`, "fill", [{ fieldId: email.id, value }]);
  }
}

/** The strictest matching rule every search's results agree with. */
function ruleOf(results: [string, string[]][]): { rule?: string } {
  const withHits = results.filter(([q, r]) => q && r.length);
  if (!withHits.length) return {};
  const lower = (s: string) => s.toLowerCase();
  const all = (test: (label: string, q: string) => boolean) =>
    withHits.every(([q, r]) => r.every((l) => test(lower(l), lower(q))));
  if (all((l, q) => l.startsWith(q))) return { rule: "prefix" };
  if (all((l, q) => l.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q)))) return { rule: "word" };
  if (all((l, q) => l.includes(q))) return { rule: "contains" };
  return { rule: "other (fuzzy, or matching more than the label)" };
}

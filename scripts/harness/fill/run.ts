import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FillResult, FormSchema, NextResult, OptionInfo, PageAction } from "@ezapply/protocol";
import { CLONE_DESCRIPTIONS, type CloneDescription } from "@ezapply/sites/clones";
import { Adapter, siteFor } from "../lib/browser.ts";
import { openClone } from "../lib/open.ts";
import { PLACEHOLDER_PDF, placeholder } from "../lib/profile.ts";
import { loadClone } from "../lib/store.ts";

type Schema = Omit<FormSchema, "tabId">;

interface FillOptions {
  latency: number;
  headed?: boolean;
  log: (line: string) => void;
  /** The site's description; by default the site's `clone.ts`. */
  desc?: CloneDescription;
}

interface FillReport {
  ok: boolean;
  clone: string;
  /** Where the screenshots, traces and this report are. */
  dir: string;
  ms: number;
  steps: string[];
  /** Why the run failed: fields that didn't fill or read back, refusals, the hand-off not reached. */
  failures: string[];
  /** Requests the stand-in couldn't answer, and any submit it saw. */
  problems: string[];
  /** Synthetic presses of Submit the adapter's guard blocked: any fails the run. */
  blockedSubmits: string[];
}

const TEXTS = new Set(["text", "textarea", "number", "date"]);
const handOff = (f: Schema) => f.pageKind === "review" || f.pageKind === "confirmation" || !!f.lastPage;

/**
 * A scripted fill run on a clone: the site's built adapter fills every field of every step with placeholder values
 * as the agent would, reads each back, adds and removes a row, and goes on with Next to the hand-off. It passes when
 * every value reads back as written, the hand-off is reached, the stand-in answered every request and nothing
 * pressed Submit. A screenshot per step, every call's debug trace and the report go into the clone's `runs/`.
 */
export async function fillRun(cloneDir: string, o: FillOptions): Promise<FillReport> {
  const started = Date.now();
  const clone = await loadClone(cloneDir);
  const desc = o.desc ?? CLONE_DESCRIPTIONS[clone.meta.site as keyof typeof CLONE_DESCRIPTIONS] ?? { endpoints: [] };
  const dir = join(cloneDir, "runs", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(dir, { recursive: true });
  const opened = await openClone(clone, desc, { latency: o.latency, ...(o.headed ? { headed: true } : {}) });
  const adapter = new Adapter(opened.page, siteFor(clone.meta.url));
  const failures: string[] = [];
  const steps: string[] = [];
  let blockedSubmits: string[] = [];
  const call = async <T>(method: string, ...args: unknown[]): Promise<T | undefined> => {
    try {
      return await adapter.call<T>(method, ...args);
    } catch (err) {
      failures.push((err as Error).message);
      return undefined;
    } finally {
      await opened.quiet();
    }
  };
  try {
    let form = await call<Schema>("getForm");
    for (let i = 0; form && (form.pageKind === "posting" || form.pageKind === "start-choice") && i < 4; i++) {
      const action = (["apply_manually", "apply"] as PageAction[]).find((a) => form?.actions.includes(a));
      if (!action) break;
      await call("pageAction", action);
      await opened.page.waitForLoadState("domcontentloaded").catch(() => {});
      form = await call<Schema>("getForm");
    }
    for (let s = 0; form && s < 25; s++) {
      const name = form.step?.title ?? form.pageKind;
      steps.push(name);
      o.log(`step: ${name}`);
      await fillStep(call, desc, failures);
      form = await call<Schema>("getForm");
      if (!form) break;
      const row = form.addButtons.find((b) => b.kind === "row");
      if (row) {
        const before = new Set(form.sections.map((x) => x.id));
        await call("addRepeatable", row.id);
        const added = (await call<Schema>("getForm"))?.sections.find((x) => !before.has(x.id) && x.removable);
        if (!added) failures.push(`${row.id}: no row was added`);
        else if (!(await call<{ ok: boolean }>("removeRepeatable", added.id))?.ok)
          failures.push(`${added.id}: not removed`);
        form = await call<Schema>("getForm");
      }
      await writeFile(join(dir, `step-${s + 1}.png`), await opened.page.screenshot({ fullPage: true }));
      if (!form || handOff(form)) break;
      const r = await call<NextResult>("next");
      if (!r?.advanced) {
        failures.push(`Next on "${name}" didn't go on: ${r?.refusedReason ?? r?.errors.join("; ") ?? "no answer"}`);
        break;
      }
      form = await call<Schema>("getForm");
    }
    if (form && !handOff(form)) failures.push(`The hand-off wasn't reached (ended on a ${form.pageKind} page).`);
    blockedSubmits = (await call<string[]>("blockedSubmitAttempts")) ?? [];
  } finally {
    await opened.close();
  }
  const problems = opened.standIn.problems.map((p) => `${p.kind}: ${p.method} ${p.url} (${p.detail})`);
  const report: FillReport = {
    ok: !failures.length && !problems.length && !blockedSubmits.length,
    clone: clone.id,
    dir,
    ms: Date.now() - started,
    steps,
    failures,
    problems,
    blockedSubmits,
  };
  await writeFile(join(dir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(dir, "traces.json"), JSON.stringify(adapter.traces));
  return report;
}

/**
 * Every field of the step filled with placeholder values, each read back from the fill's own result; the form read
 * again after each, so fields an answer opens are filled too.
 */
async function fillStep(
  call: <T>(method: string, ...args: unknown[]) => Promise<T | undefined>,
  desc: CloneDescription,
  failures: string[],
): Promise<void> {
  const done = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const form = await call<Schema>("getForm");
    const field = form?.sections.flatMap((x) => x.fields).find((x) => !done.has(x.id));
    if (!field) return;
    done.add(field.id);
    let value: string | string[] | boolean | undefined;
    if (TEXTS.has(field.kind)) value = placeholder(field, "first");
    else if (field.kind === "checkbox") value = true;
    else if (field.kind === "file") {
      if (desc.explorer?.uploads) {
        const r = await call<FillResult>("upload", field.id, PLACEHOLDER_PDF);
        if (!r?.ok) failures.push(`${field.id}: upload failed (${r?.error ?? "no answer"})`);
      }
      continue;
    } else if (field.kind !== "password") {
      let options = field.options ?? [];
      if (!options.length) options = ((await call<OptionInfo[]>("listOptions", field.id)) ?? []).map((x) => x.label);
      if (!options.length)
        options = ((await call<OptionInfo[]>("searchOptions", field.id, "a")) ?? []).map((x) => x.label);
      if (!options.length) {
        failures.push(`${field.id}: no options`);
        continue;
      }
      const first = options[0] as string;
      value = field.multiple ? [first] : first;
    }
    if (value === undefined) continue;
    const [r] = (await call<FillResult[]>("fill", [{ fieldId: field.id, value }])) ?? [];
    if (!r?.ok) failures.push(`${field.id}: ${r?.error ?? "no answer"}`);
    else if (r.readBack !== undefined && JSON.stringify(r.readBack) !== JSON.stringify(value)) {
      failures.push(`${field.id}: wrote ${JSON.stringify(value)}, read back ${JSON.stringify(r.readBack)}`);
    }
  }
}

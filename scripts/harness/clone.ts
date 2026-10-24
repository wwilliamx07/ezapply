/**
 * `npm run clone -- <posting-url> [--headless] [--max-queries <n>]`: clones a posting's application into
 * `.clones/<site>/<id>/`.
 * `npm run clone -- --check <site|clone-id>`: checks a clone again, after its site's description changed.
 */
import { parseArgs } from "node:util";
import { CLONE_DESCRIPTIONS } from "@ezapply/sites/clones";
import { checkClone, cloneSite } from "./clone/run.ts";
import { findClone, loadClone } from "./lib/store.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { check: { type: "string" }, headless: { type: "boolean" }, "max-queries": { type: "string" } },
});
const log = (line: string) => console.log(line);

if (values.check) {
  const dir = await findClone(values.check);
  if (!dir) throw new Error(`No clone "${values.check}" in .clones/.`);
  const clone = await loadClone(dir);
  const desc = CLONE_DESCRIPTIONS[clone.meta.site as keyof typeof CLONE_DESCRIPTIONS] ?? { endpoints: [] };
  process.exitCode = (await checkClone(clone, desc, log)) ? 0 : 1;
} else {
  const url = positionals[0];
  if (!url) throw new Error("Usage: npm run clone -- <posting-url> [--headless] | --check <site|clone-id>");
  const { usable } = await cloneSite(url, {
    headed: !values.headless,
    log,
    ...(values["max-queries"] ? { maxQueries: Number(values["max-queries"]) } : {}),
  });
  if (!usable) log("Not usable yet: see clone.json's report, and proposed-clone.ts for the site's description.");
  process.exitCode = usable ? 0 : 1;
}

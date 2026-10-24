/**
 * `npm run fill -- <site|clone-id> [--latency <x>] [--headed]`: a scripted fill run on a site's newest usable clone
 * (or the clone named), reported in the clone's `runs/`.
 */
import { parseArgs } from "node:util";
import { fillRun } from "./fill/run.ts";
import { findClone } from "./lib/store.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { latency: { type: "string" }, headed: { type: "boolean" } },
});
const which = positionals[0];
if (!which) throw new Error("Usage: npm run fill -- <site|clone-id> [--latency <x>] [--headed]");
const dir = await findClone(which);
if (!dir) throw new Error(`No clone "${which}" in .clones/: make one with npm run clone -- <posting-url>.`);
const report = await fillRun(dir, {
  latency: values.latency === undefined ? 1 : Number(values.latency),
  headed: !!values.headed,
  log: (line) => console.log(line),
});
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;

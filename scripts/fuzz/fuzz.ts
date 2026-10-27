import { rmSync } from "node:fs";
import { parseArgs } from "node:util";
import { fuzz, pick, SHOTS } from "./run.ts";

// npm run fuzz -- [section | scenario …] [--update] [--no-compare] [--headed] [--seed <n>] [--steps <n>] [--workers <n>] [--parallel <n>]
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    update: { type: "boolean", default: false },
    "no-compare": { type: "boolean", default: false },
    headed: { type: "boolean", default: false },
    seed: { type: "string", default: "1" },
    steps: { type: "string", default: "40" },
    workers: { type: "string", default: "6" },
    parallel: { type: "string", default: "3" },
  },
});

const scenarios = pick(positionals);
rmSync(SHOTS, { recursive: true, force: true });
const started = Date.now();
const { reports, failures } = await fuzz(scenarios, {
  update: values.update,
  compare: !values["no-compare"],
  headed: values.headed,
  seed: Number(values.seed),
  steps: Number(values.steps),
  workers: Number(values.workers),
  parallel: Number(values.parallel),
  log: (line) => console.log(line),
});

const newGoldens = reports.flatMap((r) => r.newGoldens);
if (newGoldens.length) console.log(`\n${newGoldens.length} new goldens written (look at them before committing).`);
console.log(`\nScreenshots: ${SHOTS}`);
if (failures.length) {
  console.log(`\n${failures.length} failures:`);
  for (const f of failures) {
    console.log(`\n[${f.kind}]${f.scenario ? ` ${f.scenario}` : ""}${f.page ? ` ${f.page}` : ""}`);
    console.log(`  ${f.message}`);
    if (f.path) console.log(`  path: ${f.path}`);
  }
}
console.log(`\n${failures.length ? "FAIL" : "PASS"} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exitCode = failures.length ? 1 : 0;

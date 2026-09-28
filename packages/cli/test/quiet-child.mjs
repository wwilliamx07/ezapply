// Run by quiet.test.ts as `ezapply chat` runs the companion: with the console quieted and the crash guard on,
// it prints through every channel a library might use, extracts a posting whose CSS doesn't parse (jsdom),
// and throws from a timer and a promise. Nothing of it may reach stdout or stderr, and the process lives on.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLogger, startCompanion } from "@ezapply/companion";
import { guardProcess, quietProcess } from "../dist/quiet.js";

const dir = process.env.CHILD_DIR;
const log = createLogger();
guardProcess(log);
quietProcess(log);

console.log("console.log reached the terminal");
console.warn("console.warn reached the terminal");
console.error("console.error reached the terminal");
process.stderr.write("stderr reached the terminal\n");

const handle = await startCompanion({
  config: {
    schemaVersion: 1,
    host: "127.0.0.1",
    port: 0,
    mcpToken: "t".repeat(43),
    pairingToken: "ABCD-EFGH-JKLM-NPQR",
    workspace: join(dir, "ws"),
  },
  log,
  appDataDir: join(dir, "app"),
  saveConfig: async () => {},
});
const html = `<style>@media {{{ not css</style><h1>Data Engineer</h1><p>${"Build data pipelines. ".repeat(40)}</p>`;
await handle.services.postings.capture({
  url: "https://jobs.example.com/data-engineer",
  pageTitle: "Data Engineer at Example",
  html,
  visibleHtml: html,
  visibleText: "Data Engineer",
  jsonLd: [],
  capturedAt: "2026-09-26T12:00:00.000Z",
  tabId: 1,
});

setTimeout(() => {
  throw new Error("a bug in a timer");
}, 0);
Promise.reject(new Error("a forgotten promise"));
await new Promise((r) => setTimeout(r, 300));

await handle.close();
writeFileSync(join(dir, "alive"), "yes");

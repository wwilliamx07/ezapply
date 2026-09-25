/**
 * Live check of the Workday adapter against a public careers site, in headless Chromium.
 * Walks: job list → first posting → Apply → start-choice → Apply Manually (stops at sign-in),
 * printing what the adapter sees and saving each page's HTML for new test fixtures.
 * Never signs in, creates accounts or fills anything.
 *
 *   npm run build && node scripts/workday-recon.mjs https://<tenant>.wd5.myworkdayjobs.com/<site> [outDir]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const [url, outDir = join(process.cwd(), "recon-out")] = process.argv.slice(2);
if (!url) {
  console.error("usage: node scripts/workday-recon.mjs <careers-site-url> [outDir]");
  process.exit(2);
}
const adapter = join(dirname(fileURLToPath(import.meta.url)), "..", "packages", "extension", "dist", "workday-main.js");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const inspect = async (name) => {
  await page.waitForTimeout(2000);
  writeFileSync(join(outDir, `${name}.html`), await page.content());
  await page.addScriptTag({ path: adapter });
  const form = await page.evaluate(() => window.__ezapplyWorkday.getForm());
  console.log(`\n[${name}] ${page.url()}`);
  console.log(
    JSON.stringify(
      {
        pageKind: form.pageKind,
        step: form.step,
        actions: form.actions,
        nextLabel: form.nextLabel,
        fields: form.sections.flatMap((s) => s.fields.map((f) => `${f.id} (${f.kind}) ${f.label}`)),
      },
      null,
      1,
    ),
  );
  return form;
};
const act = (a) => page.evaluate((x) => window.__ezapplyWorkday.pageAction(x), a);

try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  await page.locator('a[data-automation-id="jobTitle"]').first().click();
  await page.waitForSelector('[data-automation-id="jobPostingHeader"]', { timeout: 30_000 });
  const posting = await inspect("posting");
  if (posting.actions.includes("apply")) {
    await act("apply");
    const choice = await inspect("start-choice");
    if (choice.actions.includes("apply_manually")) {
      await act("apply_manually");
      await inspect("after-apply-manually");
    }
  }
  await page.screenshot({ path: join(outDir, "last.png") });
} finally {
  await browser.close();
}
console.log(`\nSnapshots saved in ${outDir}`);

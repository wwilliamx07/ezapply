// @vitest-environment jsdom
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installDomShims } from "../../../../engine/test/shims.js";
import { createOracleApi } from "../../../test/adapters.js";
import { buildOracleApplication } from "./fixture.js";

/**
 * Golden schemas: what the Oracle adapter extracts from every fixture state and saved page, kept in test/golden/.
 * Written before the adapters moved onto the shared engine, so the move can show it changed nothing a page reads
 * as. `UPDATE_GOLDEN=1 npx vitest run packages/sites/src/oracle/test/golden.test.ts` rewrites them after an intended
 * change; review the diff.
 */

installDomShims(document.defaultView as Window);

const dir = join(import.meta.dirname, "golden");
const update = process.env.UPDATE_GOLDEN === "1";

function golden(name: string, value: unknown): void {
  const file = join(dir, `${name}.json`);
  const json = JSON.parse(JSON.stringify(value));
  if (update || !existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
    return;
  }
  expect(json).toEqual(JSON.parse(readFileSync(file, "utf8")));
}

const ORACLE = "https://jobs.acme.com/en/sites/CX_1/job/42/apply/section/1";

const oracle = (opts: Parameters<typeof buildOracleApplication>[1] = {}) => {
  buildOracleApplication(document, opts);
  return createOracleApi(document, () => ORACLE);
};

const live = (name: string) => {
  const html = readFileSync(join(import.meta.dirname, "..", "fixtures", `${name}.html`), "utf8");
  document.documentElement.innerHTML = html.replace(/^<!--[\s\S]*?-->\s*/, "");
};

describe("golden schemas: Oracle", () => {
  it("the single-page application, a returning candidate, a resume on file", () => {
    golden("oracle-single-page", oracle().getForm());
    golden("oracle-profile-choice", oracle({ profileChoice: true }).getForm());
    golden("oracle-resume-on-file", oracle({ resumeOnFile: "old.pdf" }).getForm());
  });

  it("each section of the multi-page flow", async () => {
    const api = oracle({ multiPage: true });
    golden("oracle-multi-page-1", api.getForm());
    await api.fill([{ fieldId: "contact-information.lastName", value: "Doe" }]);
    await api.next();
    golden("oracle-multi-page-2", api.getForm());
    await api.next();
    golden("oracle-multi-page-3", api.getForm());
  });

  it("an inline language form open, and its tile once saved", async () => {
    const api = oracle();
    await api.addRepeatable("add.language");
    golden("oracle-language-form", api.getForm());
    await api.fill([
      { fieldId: "languages.language", value: "French" },
      { fieldId: "languages.readingLevel", value: "Fluent" },
    ]);
    await api.addRepeatable("save.languages");
    golden("oracle-language-saved", api.getForm());
  });

  it("the live snapshots", () => {
    const job = "https://jobs.umbrella.example/en/sites/CX_1/job/10001";
    const pages: [string, string][] = [
      ["oracle-posting", job],
      ["oracle-email", `${job}/apply/email`],
      ["oracle-apply", `${job}/apply/section/1`],
    ];
    for (const [name, url] of pages) {
      live(name);
      golden(`oracle-live-${name.replace(/^oracle-/, "")}`, createOracleApi(document, () => url).getForm());
    }
  });
});

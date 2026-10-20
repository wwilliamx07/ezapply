// @vitest-environment jsdom
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installDomShims } from "../../../../engine/test/shims.js";
import { createWorkdayApi } from "../../../test/adapters.js";
import { buildWorkdayStep } from "./fixture.js";

/**
 * Golden schemas: what the Workday adapter extracts from every fixture state and saved page, kept in test/golden/.
 * A change that only moves code leaves them equal. `UPDATE_GOLDEN=1 npx vitest run packages/sites/src/workday/test/golden.test.ts` rewrites them after an intended
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

const WORKDAY = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply";

const workday = (opts: Parameters<typeof buildWorkdayStep>[1] = {}) => {
  buildWorkdayStep(document, opts);
  return createWorkdayApi(document, () => WORKDAY);
};

const live = (name: string) => {
  const html = readFileSync(join(import.meta.dirname, "..", "fixtures", `${name}.html`), "utf8");
  document.documentElement.innerHTML = html.replace(/^<!--[\s\S]*?-->\s*/, "");
};

describe("golden schemas: Workday", () => {
  it("the fixture step, as built and with each option", () => {
    golden("workday-step", workday().getForm());
    golden("workday-step-live-dropdowns", workday({ liveDropdowns: true }).getForm());
    golden("workday-step-date-widget", workday({ dateWidget: "keys" }).getForm());
    golden("workday-step-same-titles", workday({ sameStepTitles: true }).getForm());
    golden("workday-step-date-error", workday({ dateNeedsSecondPass: true }).getForm());
  });

  it("after adding a row, after a refused Next, and on review", async () => {
    let api = workday();
    await api.addRepeatable("add.work-experience");
    golden("workday-step-added-row", api.getForm());
    api = workday();
    await api.next();
    golden("workday-step-errors", api.getForm());
    api = workday();
    await api.fill([{ fieldId: "my-information.legalName--firstName", value: "Jane" }]);
    await api.next();
    golden("workday-review", api.getForm());
  });

  it("the live snapshots", () => {
    const url = "https://initech.wd5.myworkdayjobs.com/en-US/InitechCareers/job/x";
    for (const name of ["posting", "start-choice", "auth"]) {
      live(name);
      golden(`workday-live-${name}`, createWorkdayApi(document, () => url).getForm());
    }
  });
});

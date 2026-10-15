import { settle, text, waitFor, watchRequests } from "@ezapply/engine/dom";
import { titledJob } from "@ezapply/engine/standard";
import { T } from "@ezapply/engine/timing";
import type { SiteDefinition } from "@ezapply/engine/types";
import { siteInfo } from "../../registry.js";
import {
  backButton,
  detectPage,
  fieldContainerCount,
  isSubmitControl,
  nextButton,
  pageActions,
  pageErrors,
  pageMessages,
  stepInfo,
  workdayAddButtons,
  workdayFields,
  workdayRows,
} from "./page.js";
import { confirmRemoval } from "./remove.js";
import { SEL } from "./selectors.js";
import { WORKDAY_WIDGETS } from "./widgets.js";

const ACTIONS = {
  apply: SEL.applyButton,
  apply_manually: SEL.applyManually,
  autofill_with_resume: SEL.autofillWithResume,
  use_last_application: SEL.useLastApplication,
} as const;

/**
 * Workday (`*.myworkdayjobs.com`, `*.myworkdaysite.com`): a multi-step application with a progress bar, fields in
 * `formField-*` containers keyed by automation id, listbox dropdowns, prompts, split dates, and rows (work
 * history, education, languages, websites) added with Add and deleted with their own Delete button. See
 * references/components/sites.md.
 */
export const workday: SiteDefinition = {
  info: siteInfo("workday") as NonNullable<ReturnType<typeof siteInfo>>,
  widgets: WORKDAY_WIDGETS,
  fields: (doc) => workdayFields(doc, WORKDAY_WIDGETS),
  addButtons: workdayAddButtons,
  rows: workdayRows,
  page: {
    kind: (doc, _url, fieldCount) => detectPage(doc, fieldCount),
    job: (doc) => titledJob(text(doc.querySelector(SEL.jobTitle))),
    step: stepInfo,
    // Live step titles are often all "Application", so a move is seen in the index as well as the title.
    stepKey: (doc) => {
      const s = stepInfo(doc);
      return `${s?.index ?? ""}|${s?.title ?? ""}`;
    },
    errors: pageErrors,
    messages: pageMessages,
    actions: pageActions,
    actionButton: (doc, action) => doc.querySelector<HTMLElement>(ACTIONS[action]),
    next: nextButton,
    back: backButton,
    label: text,
    isSubmit: isSubmitControl,
  },
  repeat: {
    noun: "row",
    added: fieldContainerCount,
    removed: fieldContainerCount,
    deleteButton: async (row) => row.button ?? null,
    confirmRemoval,
  },
  fill: { order: "given" },
  waits: {
    afterField: (doc) => settle(doc, T.afterFieldQuietMs, T.afterFieldMaxMs),
    afterRow: (doc) => settle(doc, T.rowQuietMs, T.rowMaxMs),
    /**
     * After a move, wait for the new step to show its fields: Workday moves the progress bar before the step
     * renders, and in two live runs a get_form straight after go_next read an empty step four times (its
     * questions were there a second or two later). The review page has no fields, so it isn't waited for.
     *
     * Then for the requests the step started: on a step filled before, Workday fetches each dropdown's values
     * after rendering it and shows the saved choice only once they're in. Seen live after going back and forward:
     * the page went quiet with those requests still out, and the read gave every dropdown as empty.
     */
    afterStep: async (doc, moved) => {
      if (!moved || detectPage(doc, 0) === "review") return settle(doc, T.stepQuietMs, T.stepMaxMs);
      const requests = watchRequests(doc);
      try {
        await waitFor(() => workdayFields(doc, WORKDAY_WIDGETS).length > 0, T.stepFieldsMs, 150);
        await settle(doc, T.stepQuietMs, T.stepMaxMs);
        if (requests.pending() > 0) {
          await waitFor(() => requests.pending() === 0, T.stepRequestsMs, 100);
          await settle(doc, T.stepQuietMs, T.stepMaxMs);
        }
      } finally {
        requests.stop();
      }
    },
    afterAction: (doc) => settle(doc, T.pageActionQuietMs, T.pageActionMaxMs),
  },
  messages: {
    noNextButton: "No Next / Save and Continue button found.",
    noBackButton: "No Back button on this page (it's the first step).",
    submitIsNext: (button) => `The forward button is "${text(button)}". The user must press it.`,
    refuseNext: (kind) =>
      kind === "review" || kind === "confirmation"
        ? "This is the review page. The user must press Submit themselves."
        : undefined,
    noSearch: "search_options only applies to typeahead fields.",
    cantRemove: (kind) =>
      `remove_items works on multi-select (typeahead) and file fields; this is a ${kind} field. Use fill_fields to change it.`,
  },
};

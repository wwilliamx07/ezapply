import { isVisible, settle, waitFor, win } from "@ezapply/engine/dom";
import { T } from "@ezapply/engine/timing";
import type { SiteDefinition } from "@ezapply/engine/types";
import { siteInfo } from "../../registry.js";
import {
  actionButton,
  backButton,
  detectPage,
  isSubmitControl,
  jobInfo,
  labelOf,
  nextButton,
  oracleAddButtons,
  oracleFields,
  oracleRows,
  pageActions,
  pageErrors,
  pageMessages,
  savedItems,
  stepInfo,
  visibleRowCount,
} from "./page.js";
import { SEL } from "./selectors.js";
import { confirmRemoval, ORACLE_WIDGETS } from "./widgets.js";

/**
 * Oracle Recruiting Cloud (Candidate Experience, on Oracle Cloud hosts and employers' own domains): one page with
 * every section, or one section per page; form rows (`.input-row`) with cx-select lists, pills, native radios, date
 * lists and attachment buttons; work, education, languages and licenses added through inline forms with a Save,
 * shown afterwards as tiles and timeline entries. See references/components/sites.md.
 */
export const oracle: SiteDefinition = {
  info: siteInfo("oracle") as NonNullable<ReturnType<typeof siteInfo>>,
  widgets: Object.values(ORACLE_WIDGETS),
  fields: (doc) => oracleFields(doc, ORACLE_WIDGETS),
  addButtons: oracleAddButtons,
  rows: oracleRows,
  page: {
    kind: detectPage,
    step: stepInfo,
    job: jobInfo,
    stepKey: (doc, url) => `${url}|${JSON.stringify(stepInfo(doc) ?? null)}`,
    errors: pageErrors,
    messages: pageMessages,
    actions: pageActions,
    actionButton,
    next: nextButton,
    back: backButton,
    label: labelOf,
    isSubmit: isSubmitControl,
  },
  repeat: {
    noun: "item",
    added: visibleRowCount,
    removed: (doc) => savedItems(doc).length,
    /** A tile's delete button; a timeline entry shows its own only while hovered, so it's hovered first. */
    deleteButton: async (row) => {
      row.el.scrollIntoView?.({ block: "center" });
      if (row.el.matches(SEL.tile)) return row.el.querySelector<HTMLElement>(SEL.tileDelete);
      const w = win(row.el);
      row.el.dispatchEvent(new w.MouseEvent("mouseover", { bubbles: true }));
      row.el.dispatchEvent(new w.FocusEvent("focusin", { bubbles: true }));
      return waitFor(() => row.el.querySelector<HTMLElement>(SEL.timelineDelete), T.removeRowMs);
    },
    confirmRemoval,
    /** The form and its Save button's footer are siblings in the block: its errors show there. */
    saveErrors: (button) =>
      [...(button.closest(SEL.block) ?? button.ownerDocument).querySelectorAll(SEL.inlineErrors)].filter(isVisible)
        .length,
  },
  fill: { order: "page", waitForStaleErrors: true, scrollBeforeUpload: true, newErrorsOnly: true },
  waits: {
    afterField: (doc) => settle(doc, T.afterFieldQuietMs, T.afterFieldMaxMs),
    afterRow: (doc) => settle(doc, T.rowQuietMs, T.rowMaxMs),
    afterStep: (doc) => settle(doc, T.stepQuietMs, T.stepMaxMs),
    afterAction: (doc) => settle(doc, T.pageActionQuietMs, T.pageActionMaxMs),
  },
  messages: {
    noNextButton: "No Next button found.",
    noBackButton: "No Previous button on this page (it's the first section).",
    submitIsNext: () =>
      "The only way forward is Submit: every section is filled on this page. The user reviews it and presses Submit.",
    refuseNext: (kind) =>
      kind === "confirmation"
        ? "The application was already submitted."
        : kind === "auth"
          ? "This is the sign-in (email) step. The user completes it themselves."
          : undefined,
    noSearch: "search_options applies to dropdown fields on Oracle pages.",
    cantRemove: (kind) =>
      `remove_items works on file fields and multi-selects; this is a ${kind} field. Use fill_fields to change it.`,
  },
};

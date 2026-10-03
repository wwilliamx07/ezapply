/**
 * Oracle Recruiting Cloud (Candidate Experience) hooks. Keep every Oracle-specific string of the adapter in
 * this file; which URLs are Oracle pages and the tenant live in protocol/src/oracle.ts.
 *
 * The apply flow is Knockout components with React widgets inside (`cx-select`, `cx-select-pills`). Its class
 * names are BEM and stable across tenants; there are no automation ids. What is marked "from the page's own
 * templates" was read from the Candidate Experience bundle of a live tenant, not seen rendered.
 */
export const SEL = {
  /** A form row: label plus control(s). Nested rows exist (email); the innermost is the field. */
  row: ".input-row",
  /**
   * A bot trap on the email step: a text field people can't see ("honeypot"). Filling it marks the applicant a
   * bot, so it's never a field. (Seen live.)
   */
  botTrap: ".input-row--invisible, [name='honey-pot'], input[aria-hidden='true']",
  rowLabel: "label.input-row__label, .input-row__label",
  rowLabelText: ".input-row__linebreak, .input-row__label-text",
  requiredLabel: ".input-row__label--required, .cx-select__label--required",
  rowError: ".input-row__validation",
  /** A section of the flow: one per page in the multi-page flow, all on one page in the single-page flow. */
  section: ".apply-flow-section",
  sectionTitle: ".apply-flow-section__trainstop-name",
  /** Before the numbered sections: profile import (LinkedIn, Indeed). */
  preSection: "[id^='presection-']",
  block: "apply-flow-block, .apply-flow-block",
  blockTitle: ".apply-flow-block__title",
  blockInstructions: ".apply-flow-block__instructions",
  /** The flow's own hidden heading: "<job> application, step 1 of 4". */
  flowHeading: "h1.ui-helper-hidden-accessible",
  flowForm: ".apply-flow__content-form, .apply-flow-page",
  // ---- widgets ----
  /** cx-select: a React combobox; its list is `#<input id>-listbox`, options are grid cells. */
  comboInput: "input.cx-select-input",
  comboOption: "[role='gridcell'], .cx-select__list-item",
  comboOptionLabel: ".cx-select__list-item-container",
  comboNoResults: ".cx-select__list-item--no-results",
  comboAutoSuggest: "cx-select-input--auto-suggest",
  comboLoading: ".cx-select--loading",
  /** cx-select-pills: short option lists as toggle buttons (`aria-pressed`); multi-select ones show +/− icons. */
  pills: ".cx-select-pills-container",
  pill: "button.cx-select-pill-section",
  pillName: ".cx-select-pill-name",
  pillMultiIcon: ".cx-select-pill__plus-icon, .cx-select-pill__remove-icon",
  /**
   * Widgets the adapter can't drive yet: the multi-select dropdown (preferred locations) and Oracle JET's
   * comboboxes. Reported as `typeahead` so they're seen, and their fill says to ask the user.
   */
  unsupported: ".cx-multi-select-input, oj-combobox-many, oj-combobox-one, oj-select-single",
  datePart: ".datepicker-row__input",
  dateRow: ".datepicker-row",
  phoneRow: ".phone-row",
  phonePrefix: ".phone-row__prefix",
  phoneNumber: ".phone-row__number",
  checkboxLabel: "label.apply-flow-input-checkbox",
  checkboxText: ".apply-flow-input-checkbox__label",
  // ---- attachments (from the page's own templates, except the empty upload button) ----
  upload: ".attachment-upload-button",
  uploadSection: ".file-upload-wrapper__section",
  uploadDropLabel: ".attachment-upload-button__drag-and-drop-label",
  uploadRequired: ".attachment-upload-button__drag-and-drop-label--required",
  uploadButtonLabel: ".file-form-element__label",
  miscBlock: ".apply-flow-block--misc-attachments",
  /** A file the field holds: the resume/cover letter button's name, or a row of the additional documents. */
  fileName: ".attachment-upload-button__download, .misc-attachment-list__item-name, .attachments-list__item-name",
  fileRow: ".attachment-upload-button__filled, .misc-attachment-list__item, .attachments-list__item",
  fileRemove:
    ".attachment-upload-button__filled .attachment-upload-button__bottom-button, .misc-attachment-list__item-remove, .attachments-list__item-remove",
  // ---- repeatable items (from the page's own templates) ----
  addButton:
    "button.apply-flow-profile-item-tile__new-tile, button.apply-flow-profile-item-button--add, button.candidate-links__add-link",
  addButtonHidden: "candidate-links__add-link--hidden",
  /** The add button that adds a row of fields at once (another link), not an inline form. */
  addRow: "button.candidate-links__add-link",
  /** Saves an open inline form (a language, a license, a work or education entry). */
  inlineSave: "[data-qa='profileItemInlineSaveButton'], [data-qa='addTimelineItemDialogButton']",
  /** What an inline form shows when Save finds a problem: field errors, or a message under the form. */
  inlineErrors: ".input-row__validation, .profile-item-errors",
  tile: "article.apply-flow-profile-item-tile",
  tileTitle: ".apply-flow-profile-item-tile__summary-title",
  tileSubtitle: ".apply-flow-profile-item-tile__summary-subtitle",
  tileDelete: ".apply-flow-profile-item-tile__delete-icon",
  timelineItem: ".beautiful-timeline-item",
  timelineExperiences: ".beautiful-timeline__column--left",
  timelineTitle: ".beautiful-timeline-item__title",
  timelineSubtitle: ".beautiful-timeline-item__subtitle",
  /** Shown only while the item is hovered or focused. */
  timelineDelete: ".beautiful-timeline-item__delete-icon",
  // ---- page level ----
  pagination: ".apply-flow-pagination__buttons",
  nextButton: "[data-qa='applyFlowPaginationNextButton']",
  submitButton: ".apply-flow-pagination__submit-button",
  paginationError: ".apply-flow-pagination__error-message",
  errors: ".input-row__validation, .apply-flow-pagination__error-message, [role='alert']",
  /** Alerts that report progress, not problems ("Uploading", "Done"). */
  progressAlert: ".attachment-upload-button, .attachment-upload-button-mobile",
  /** The email step before the flow, and the code check that follows it (from the page's own templates). */
  auth: "email-verification-form, quick-email-verification-form, [data-qa='emailVerificationCancelButton'], input[autocomplete='one-time-code']",
  /** "Welcome Back: use this profile, or import from Indeed?" over a returning candidate's form. */
  profileChoice: ".profile-selection-overlay__main",
  dialog: "[role='dialog'], [role='alertdialog'], oj-dialog",
  dialogButton: "button.app-dialog__footer-button",
} as const;

/** Button texts (English; the Candidate Experience is localized, which these don't cover). */
export const TEXT = {
  apply: /^apply( now)?$/i,
  useMyProfile: /^use my profile$/i,
  next: /^(next|continue)$/i,
  back: /^(previous|back)$/i,
  submit: /^\s*submit(\s+application)?\s*$/i,
  confirmation:
    /thank you for (applying|your application|your interest)|application (has been |was )?(successfully )?(submitted|received)|you('ve| have) (successfully )?applied/i,
  confirmRemoval: /^(delete|remove|yes|ok|confirm)$/i,
} as const;

/**
 * Field keys (the control's id without its render counter, lowercased, alphanumerics only) → profile paths.
 * Suggestions only. The EEO questions carry Oracle's standard codes (`…-ORA_GENDER-…`), matched by `hintFor`.
 */
export const PROFILE_HINTS: Record<string, string> = {
  firstname: "identity.firstName",
  lastname: "identity.lastName",
  middlenames: "identity.middleName",
  knownas: "identity.preferredName",
  preferredname: "identity.preferredName",
  email: "contact.email",
  phonenumber: "contact.phone.number",
  phonecountrycode: "contact.phone.countryCode",
  country: "contact.address.country",
  addressline1: "contact.address.line1",
  addressline2: "contact.address.line2",
  city: "contact.address.city",
  townorcity: "contact.address.city",
  region1: "contact.address.region",
  region2: "contact.address.region",
  postalcode: "contact.address.postalCode",
  employername: "work[].company",
  jobtitle: "work[].title",
  responsibilities: "work[].highlights",
  educationalestablishment: "education[].school",
  schoolname: "education[].school",
  degreename: "education[].degree",
  major: "education[].field",
  gpa: "education[].gpa",
};

const EEO_HINTS: [RegExp, string][] = [
  [/ORA_GENDER/i, "eeo.gender"],
  [/ORA_ETHNICITY|ORA_RACE/i, "eeo.race"],
  [/ORA_DISABILITY_STATUS/i, "eeo.disability"],
  [/ORA_VETERAN/i, "eeo.veteranStatus"],
];

export function hintFor(key: string): string | undefined {
  const plain = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return PROFILE_HINTS[plain] ?? EEO_HINTS.find(([re]) => re.test(key))?.[1];
}

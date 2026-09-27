/**
 * Workday data-automation-id hooks. Workday ships variants across tenants and releases, so most
 * lookups list several candidates. Keep every Workday-specific string in this file.
 */
export const A = (id: string) => `[data-automation-id="${id}"]`;
export const any = (...ids: string[]) => ids.map(A).join(",");

/** Scope a descendant selector under every alternative of a comma-separated selector list. */
export const within = (list: string, child: string) =>
  list
    .split(",")
    .map((s) => `${s.trim()} ${child}`)
    .join(",");

export const SEL = {
  fieldContainer: '[data-automation-id^="formField-"]',
  progressBar: any("progressBar"),
  progressStep: `${A("progressBar")} li`,
  progressActive: any("progressBarActiveStep"),
  nextButton: any("bottom-navigation-next-button", "pageFooterNextButton", "wd-CommandButton_next"),
  errors: `${any("errorMessage", "errorBanner", "inputAlert")},[role="alert"]`,
  postingHeader: any("jobPostingHeader"),
  applyButton: any("adventureButton", "applyButton"),
  applyManually: any("applyManually"),
  autofillWithResume: any("autofillWithResume"),
  useLastApplication: any("useMyLastApplication"),
  // Not utilityButtonSignIn: that header link is on every page. (Verified on a live tenant.)
  auth: any("signInContent", "createAccountContent", "signInSubmitButton", "createAccountSubmitButton"),
  multiSelect: `${any("multiSelectContainer")},[data-uxi-widget-type="multiselect"]`,
  selectedItem: any("selectedItem", "selectedItemList"),
  /** Chips showing a typeahead's selected values. */
  selectedChips: `${A("selectedItemList")} li,${A("selectedItem")}`,
  /** One selected value (pill) of a multi-select; `selectedItem` when present, else the list's items. */
  chip: any("selectedItem"),
  chipInList: within(any("selectedItemList"), "li"),
  chipLabel: any("promptSelectionLabel", "selectedItemLabel"),
  /** The pill's remove icon ("charm"); some tenants only label it. Unverified on a live tenant. */
  chipRemove: `${any("DELETE_charm", "deleteButton", "removeButton")},[role="button"][aria-label*="delete" i],[role="button"][aria-label*="remove" i],button[aria-label*="delete" i],button[aria-label*="remove" i]`,
  promptOption: any("promptOption", "promptLeafNode"),
  popup: '[data-automation-widget="wd-popup"]',
  fileDropZone: any("file-upload-drop-zone"),
  fileInput: `${A("file-upload-input-ref")},input[type="file"]`,
  fileItem: any("file-upload-item-name", "file-upload-successful", "file-upload-item"),
  /** One attached file: its row, its name, and its delete button. Unverified on a live tenant. */
  fileRow: any("file-upload-item", "file-upload-successful"),
  fileName: any("file-upload-item-name"),
  fileRemove: `${any("delete-file", "file-upload-delete", "DELETE_charm")},button[aria-label*="delete" i],button[aria-label*="remove" i]`,
  /** A confirmation some tenants show before removing an attachment. */
  dialog: '[role="dialog"],[role="alertdialog"]',
  addButton: `${any("Add", "add-button", "addButton")},button[aria-label^="Add"]`,
  helpText: `${any("helpText", "formFieldHelpText")},[id$="-helpText"]`,
  confirmation: any("applicationSubmittedMessage", "confirmationMessage", "thankYouMessage"),
} as const;

/** Well-known field keys (automation id minus "formField-", lowercased, alphanumerics only) → profile paths. */
export const PROFILE_HINTS: Record<string, string> = {
  legalnamefirstname: "identity.firstName",
  firstname: "identity.firstName",
  legalnamelastname: "identity.lastName",
  lastname: "identity.lastName",
  legalnamemiddlename: "identity.middleName",
  middlename: "identity.middleName",
  preferredname: "identity.preferredName",
  email: "contact.email",
  emailaddress: "contact.email",
  addressline1: "contact.address.line1",
  addresssectionaddressline1: "contact.address.line1",
  addressline2: "contact.address.line2",
  city: "contact.address.city",
  addresssectioncity: "contact.address.city",
  countryregion: "contact.address.region",
  state: "contact.address.region",
  postalcode: "contact.address.postalCode",
  addresssectionpostalcode: "contact.address.postalCode",
  country: "contact.address.country",
  countrydropdown: "contact.address.country",
  phonenumber: "contact.phone.number",
  countryphonecode: "contact.phone.countryCode",
  phonetype: "contact.phone.type",
  phonedevicetype: "contact.phone.type",
  jobtitle: "work[].title",
  companyname: "work[].company",
  company: "work[].company",
  location: "work[].location",
  currentlyworkhere: "work[].end (null = current)",
  startdate: "work[].start",
  enddate: "work[].end",
  roledescription: "work[].highlights",
  school: "education[].school",
  schoolitem: "education[].school",
  schoolname: "education[].school",
  degree: "education[].degree",
  fieldofstudy: "education[].field",
  gradeaverage: "education[].gpa",
  gpa: "education[].gpa",
  linkedin: "links.linkedin",
  linkedinaccount: "links.linkedin",
  linkedinquestion: "links.linkedin",
  website: "links.portfolio",
  websites: "links.portfolio",
  url: "links.portfolio",
  source: "answers.how_heard",
  sourceprompt: "answers.how_heard",
  previousworker: "answers.previously_employed",
  candidateispreviousworker: "answers.previously_employed",
  gender: "eeo.gender",
  ethnicity: "eeo.race",
  hispanicorlatino: "eeo.hispanicOrLatino",
  veteranstatus: "eeo.veteranStatus",
  disability: "eeo.disability",
};

export function hintKey(automationId: string): string {
  return automationId
    .replace(/^formField-/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

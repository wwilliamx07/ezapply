// @vitest-environment jsdom

import { createAdapter } from "@ezapply/engine/api";
import { describe, expect, it } from "vitest";
import { installDomShims } from "../../../../engine/test/shims.js";
import { extractPage, fieldsOf, loadSaved as load } from "../../../test/adapters.js";
import { successfactors } from "../definition/site.js";

describe("live SuccessFactors application (career17.sapsf.com, signed in)", () => {
  // Signed in, the page's URL names neither the employer nor the job: the page says which job.
  const URL = "https://career17.sapsf.com/portalcareer?_s.crb=0000";
  const s = load(successfactors, "successfactors-application", URL);
  const f = fieldsOf(s);

  it("reads one page whose way on is Apply, the job from its heading and hidden requisition", () => {
    expect(s).toMatchObject({
      adapter: "successfactors",
      pageKind: "step",
      step: { title: "Operations Analyst" },
      nextLabel: "Apply",
      lastPage: true,
      errors: [],
      job: { title: "Operations Analyst", reqId: "1000" },
    });
    expect(s.tenant).toBeUndefined();
    expect(s.backLabel).toBeUndefined();
    const named = "https://career17.sapsf.com/career?company=soylent&career_job_req_id=1000";
    expect(load(successfactors, "successfactors-application", named).tenant).toBe("soylent");
  });

  it("reads the profile's fields by their names, hinted, and the account's username not at all", () => {
    expect(f["profile-information.firstName"]).toMatchObject({
      label: "First Name",
      kind: "text",
      required: true,
      currentValue: "Jane",
      hint: { profileKey: "identity.firstName" },
    });
    expect(f["profile-information.middleName"]).toMatchObject({ required: false });
    expect(f["profile-information.address"]?.hint).toEqual({ profileKey: "contact.address.line1" });
    expect(f["profile-information.zip"]?.hint).toEqual({ profileKey: "contact.address.postalCode" });
    expect(f["profile-information.cellPhone"]?.hint).toEqual({ profileKey: "contact.phone.number" });
    expect(f["profile-information.contactEmail"]?.hint).toEqual({ profileKey: "contact.email" });
    expect(Object.keys(f).some((id) => id.includes("username"))).toBe(false);
  });

  it("reads the lists as dropdowns whose options load on demand, keyed by their prompts", () => {
    expect(f["profile-information.country"]).toMatchObject({
      label: "Country",
      kind: "dropdown",
      optionsLazy: true,
      required: true,
      currentValue: "United States",
    });
    // The field name that would hint it is the component's, which a saved page doesn't have.
    expect(f["profile-information.country"]?.hint).toBeUndefined();
    expect(f["profile-information.province-state"]).toMatchObject({ kind: "dropdown", currentValue: "Ohio" });
    // An unanswered question shows its placeholder, not a value.
    expect(f["job-specific-information.how-did-you-hear-about-this-position"]).toMatchObject({
      kind: "dropdown",
      required: true,
      currentValue: null,
    });
  });

  it("reads each row of a list as a section of its own, numbered, with its Remove; dates with their parts", () => {
    const work = s.sections.filter((x) => x.id.startsWith("outside-work-experience-"));
    expect(work.map((x) => [x.id, x.title, x.removable])).toEqual([
      ["outside-work-experience-1", "Outside Work Experience 1", true],
      ["outside-work-experience-2", "Outside Work Experience 2", true],
    ]);
    expect(work[0]?.fields.map((x) => [x.id, x.kind, x.currentValue])).toEqual([
      ["outside-work-experience-1.company-name", "text", "Example Corp"],
      ["outside-work-experience-1.title", "text", "Analyst"],
      ["outside-work-experience-1.start-date", "date", "01/01/2024"],
      ["outside-work-experience-1.end-date", "date", "12/31/2024"],
      ["outside-work-experience-1.type-of-business", "dropdown", "Retail"],
    ]);
    expect(f["outside-work-experience-1.start-date"]).toMatchObject({
      required: true,
      dateParts: ["MM", "DD", "YYYY"],
    });
    // A list's numbered fields (`VFLD1`) mean only what their labels say: no hints.
    expect(work[0]?.fields.every((x) => !x.hint)).toBe(true);
    expect(s.sections.find((x) => x.id === "formal-education-1")?.fields.map((x) => x.label)).toEqual([
      "School",
      "Degree",
      "Major",
      "Start Date",
      "End Date",
    ]);
    expect(s.sections.find((x) => x.id === "geographic-mobility-1")).toMatchObject({ removable: true });
    expect(s.sections.find((x) => x.id === "my-documents")?.removable).toBeUndefined();
  });

  it("reads a collapsed section's fields and Add too: they're still the application's", () => {
    load(successfactors, "successfactors-application", URL);
    document.getElementById("175:sectionContent")?.setAttribute("style", "display: none");
    const collapsed = extractPage(successfactors, document, URL).schema;
    expect(collapsed.sections.find((x) => x.id === "formal-education-1")?.fields.length).toBe(5);
    expect(collapsed.addButtons.map((b) => b.id)).toContain("add.formal-education");
  });

  it("offers each list's Add as a row", () => {
    expect(s.addButtons).toEqual([
      { id: "add.outside-work-experience", label: "Add", section: "Outside Work Experience", kind: "row" },
      { id: "add.formal-education", label: "Add", section: "Formal Education", kind: "row" },
      { id: "add.certifications-licenses", label: "Add", section: "Certifications/Licenses", kind: "row" },
      { id: "add.geographic-mobility", label: "Add", section: "Geographic Mobility", kind: "row" },
    ]);
  });

  it("reads the documents: the resume, the cover letter, and Additional Documents taking several", () => {
    expect(f["my-documents.resume-cv"]).toMatchObject({
      kind: "file",
      label: "Resume/CV",
      required: true,
      currentValue: ["jane-doe-resume.pdf"],
      multiple: false,
    });
    expect(f["my-documents.cover-letter"]).toMatchObject({ currentValue: ["jane-doe-cover-letter.pdf"] });
    expect(f["my-documents.additional-documents"]).toMatchObject({ currentValue: ["transcript.pdf"], multiple: true });
  });

  it("reads Job-Specific Information by its fields' names; a typed signature unhinted", () => {
    expect(f["job-specific-information.prefName"]).toMatchObject({ hint: { profileKey: "identity.preferredName" } });
    expect(f["job-specific-information.candidateName"]?.hint).toEqual({ profileKey: "identity.fullName" });
    expect(f["job-specific-information.disclaimerAcknowledge"]).toMatchObject({
      label: "Typed Signature",
      required: true,
    });
    expect(f["job-specific-information.disclaimerAcknowledge"]?.hint).toBeUndefined();
    // `type=currency`, read as text.
    expect(f["job-specific-information.customExptSal"]).toMatchObject({
      kind: "text",
      label: "Base Salary Expectation",
    });
  });

  it("tells Apply by its hook and its words, never Save; the welcome's thanks is no confirmation", () => {
    const control = (html: string) => {
      document.body.innerHTML = html;
      return document.body.firstElementChild;
    };
    expect(successfactors.page.isSubmit(control('<span role="button" id="290:_saveBtn">Save</span>'))).toBe(false);
    expect(successfactors.page.isSubmit(control('<span role="button" id="290:_submitBtn">Postuler</span>'))).toBe(true);
    expect(successfactors.page.isSubmit(control('<span role="button">Apply</span>'))).toBe(true);
    document.body.innerHTML =
      '<div role="main"><div role="note">Thank you for your interest in Soylent.</div><p>Search jobs</p></div>';
    expect(successfactors.page.kind(document, URL, 0)).toBe("unknown");
    document.body.innerHTML =
      '<div role="main"><p>Thank you for applying. Your application has been submitted.</p></div>';
    expect(successfactors.page.kind(document, URL, 0)).toBe("confirmation");
  });
});

describe("SuccessFactors' lists, rows and documents (its components modelled from its scripts, in the saved page)", () => {
  const URL = "https://career17.sapsf.com/portalcareer?_s.crb=0000";
  installDomShims(window);

  /**
   * juic's component registry with two paginated picklists modelled: each answers
   * `getPicklistByPageWithExcludeOption` as SuccessFactors does (a page of options after "No Selection", filtered by
   * "contains"), and its `setValue` shows the label in its input.
   */
  function page() {
    load(successfactors, "successfactors-application", URL);
    const registry: Record<string, unknown> = {};
    const requests: { picklist: unknown; filter: unknown }[] = [];
    const picklist = (inputId: string, name: string, all: string[]) => {
      const input = document.getElementById(inputId) as HTMLInputElement;
      let value = { value: "", label: input.value };
      const list = {
        getFieldName: () => name,
        getValue: () => value,
        setValue: (v: { value: string; label: string }) => {
          value = v;
          input.value = v.label;
        },
        _model: {
          _picklistId: name,
          _parentOptionId: null,
          _controller: {
            getPicklistByPageWithExcludeOption: (
              _parent: unknown,
              id: unknown,
              p: { filterValue: string | null },
              ...rest: unknown[]
            ) => {
              requests.push({ picklist: id, filter: p.filterValue });
              const q = p.filterValue?.toLowerCase();
              const options = all
                .filter((o) => !q || o.toLowerCase().includes(q))
                .map((label) => ({ label, value: String(all.indexOf(label) + 1) }));
              const answer = rest.at(-1) as (r: unknown) => void;
              setTimeout(
                () =>
                  answer({
                    picklistOptions: [{ label: "No Selection", value: "" }, ...options],
                    totalCount: options.length,
                  }),
                5,
              );
            },
          },
        },
      };
      registry[inputId.replace(/_input$/, "")] = list;
      return list;
    };
    const country = picklist("88:_input", "country", ["Canada", "United Kingdom", "United States"]);
    picklist("244:_input", "customHear", ["Job board", "Referral", "Company website"]);
    (window as unknown as { juic: unknown }).juic = { Component: { _registry: registry } };
    return { country, requests };
  }

  it("lists a picklist's options from SuccessFactors and chooses one through the component", async () => {
    const { country, requests } = page();
    const api = createAdapter(successfactors, document, () => URL);
    // Hinted by the field name only the component holds.
    const fields = api.getForm().sections.flatMap((x) => x.fields);
    expect(fields.find((x) => x.id === "profile-information.country")?.hint).toEqual({
      profileKey: "contact.address.country",
    });
    expect(await api.listOptions("profile-information.country")).toEqual([
      { label: "Canada" },
      { label: "United Kingdom" },
      { label: "United States" },
    ]);
    expect(await api.searchOptions("job-specific-information.how-did-you-hear-about-this-position", "ref")).toEqual([
      { label: "Referral" },
    ]);
    const [result] = await api.fill([{ fieldId: "profile-information.country", value: "Canada" }]);
    expect(result).toMatchObject({ ok: true, readBack: "Canada" });
    expect(country.getValue()).toEqual({ value: "1", label: "Canada" });
    // The value was searched for first.
    expect(requests).toContainEqual({ picklist: "country", filter: "Canada" });
  });

  it("refuses a disabled list and names the options when nothing matches", async () => {
    page();
    const api = createAdapter(successfactors, document, () => URL);
    const [miss] = await api.fill([{ fieldId: "profile-information.country", value: "Atlantis" }]);
    expect(miss).toMatchObject({ ok: false, availableOptions: ["Canada", "United Kingdom", "United States"] });
    (document.getElementById("95:_input") as HTMLInputElement).disabled = true;
    const [disabled] = await api.fill([{ fieldId: "profile-information.province-state", value: "Ohio" }]);
    expect(disabled).toMatchObject({ ok: false, error: /disabled/ });
  });

  it("removes a row with its Remove, which asks nothing", async () => {
    page();
    // As the section's script does: the row goes at once.
    const row = document.getElementById("147:_sectionComponent")?.parentElement;
    row?.querySelector("[title='Delete Row']")?.addEventListener("click", () => row.remove());
    const api = createAdapter(successfactors, document, () => URL);
    api.getForm();
    expect(await api.removeRepeatable("outside-work-experience-2")).toMatchObject({ ok: true });
    expect(api.getForm().sections.filter((x) => x.id.startsWith("outside-work-experience-")).length).toBe(1);
  });

  /** The upload popup as the attachment view renders it (`RCMV12AttachmentPopUpContent`), opened by a field's icon. */
  function popupOn(iconId: string, uploaded: (name: string) => void) {
    document.getElementById(iconId)?.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div role="dialog"><div id="900:_attachUploadOptions" class="attachmentUploadOptions"><span id="900:_uploadComputer">Upload from my computer</span><input type="file" id="900:_file" class="fileUpload" name="fileData1"></div></div>',
      );
      const input = document.getElementById("900:_file") as HTMLInputElement;
      input.addEventListener("change", () => {
        const name = input.files?.[0]?.name ?? "";
        input.closest("[role='dialog']")?.remove();
        setTimeout(() => uploaded(name), 10);
      });
    });
  }

  it("uploads through the field's popup: a document beside Additional Documents', the resume replaced", async () => {
    page();
    // As SuccessFactors shows it once its server has the file: the empty slot names it.
    popupOn("58:_attachIcon", (name) => {
      document.getElementById("58:_attach")?.classList.replace("attachmentBtn", "successBtn");
      document.getElementById("58:_attachDownloadLabel")?.classList.remove("displayNone");
      const link = document.getElementById("58:_attachDownloadLabelLink");
      if (link) link.textContent = name;
    });
    popupOn("52:_attachIcon", (name) => {
      const link = document.getElementById("52:_attachDownloadLabelLink");
      if (link) link.textContent = name;
    });
    const api = createAdapter(successfactors, document, () => URL);
    api.getForm();
    const file = (name: string) => ({ name, mimeType: "application/pdf", base64: btoa("%PDF-1.4") });
    expect(await api.upload("my-documents.additional-documents", file("portfolio.pdf"))).toMatchObject({
      ok: true,
      readBack: ["transcript.pdf", "portfolio.pdf"],
    });
    expect(await api.upload("my-documents.resume-cv", file("new-resume.pdf"))).toMatchObject({
      ok: true,
      readBack: ["new-resume.pdf"],
    });
    // The cover letter's icon deletes it: it has to come off first.
    expect(await api.upload("my-documents.cover-letter", file("letter.pdf"))).toMatchObject({
      ok: false,
      error: /remove it first/,
    });
  });

  it("removes an optional document after its confirmation; a required one can only be replaced", async () => {
    page();
    document.getElementById("54:_attachIcon")?.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div role="dialog" class="sfDialogBox"><p>Are you sure you want to delete this file?</p><button>Cancel</button><button id="ok">OK</button></div>',
      );
      document.getElementById("ok")?.addEventListener("click", () => {
        document.querySelector(".sfDialogBox")?.remove();
        setTimeout(() => document.getElementById("54:_attach")?.setAttribute("style", "display: none"), 10);
      });
    });
    const api = createAdapter(successfactors, document, () => URL);
    api.getForm();
    expect(await api.remove("my-documents.cover-letter")).toMatchObject({
      ok: true,
      removed: ["jane-doe-cover-letter.pdf"],
    });
    expect(await api.remove("my-documents.resume-cv")).toMatchObject({ ok: false, error: /only be replaced/ });
  });

  it("knows a required document replaced under the same name by the tick the field shows", async () => {
    page();
    // The name doesn't change: only the slot's tick says the new file went in.
    popupOn("52:_attachIcon", () => document.getElementById("52:_attachSuccess")?.classList.remove("displayNone"));
    const api = createAdapter(successfactors, document, () => URL);
    api.getForm();
    const file = { name: "jane-doe-resume.pdf", mimeType: "application/pdf", base64: btoa("%PDF-1.4") };
    expect(await api.upload("my-documents.resume-cv", file)).toMatchObject({
      ok: true,
      readBack: ["jane-doe-resume.pdf"],
    });
  });

  it("says when the page re-renders during an upload, and finds the field again", async () => {
    page();
    // As seen live: the whole application rendered again, every element new, what wasn't saved gone.
    const rerender = (keep: boolean) => () => {
      const root = document.querySelector("#rcmJobApplicationCtr") as HTMLElement;
      const copy = root.cloneNode(true) as HTMLElement;
      const link = copy.querySelector("[id='58:_attachDownloadLabelLink']");
      if (keep && link) {
        copy.querySelector("[id='58:_attach']")?.classList.replace("attachmentBtn", "successBtn");
        copy.querySelector("[id='58:_attachDownloadLabel']")?.classList.remove("displayNone");
        link.textContent = "portfolio.pdf";
      }
      root.replaceWith(copy);
    };
    const file = { name: "portfolio.pdf", mimeType: "application/pdf", base64: btoa("%PDF-1.4") };

    popupOn("58:_attachIcon", rerender(true));
    let api = createAdapter(successfactors, document, () => URL);
    api.getForm();
    expect(await api.upload("my-documents.additional-documents", file)).toMatchObject({
      ok: true,
      readBack: ["transcript.pdf", "portfolio.pdf"],
      error: /re-rendered.*get_form/,
    });

    page();
    popupOn("58:_attachIcon", rerender(false));
    api = createAdapter(successfactors, document, () => URL);
    api.getForm();
    expect(await api.upload("my-documents.additional-documents", file)).toMatchObject({
      ok: false,
      readBack: ["transcript.pdf"],
      error: /re-rendered.*doesn't show in the field now/,
    });
  });

  it("reads a question's radio group by its label and chooses through the component's click", async () => {
    page();
    // A question as SuccessFactors renders it (`rcmFormQuestionLabel`, juic's radios, no inputs).
    const radio = (id: string, label: string) =>
      `<div class="globalRadio sfRadioInputField fd-form-item" id="${id}:_anchorButton"><span id="${id}:_radio" class="radioCheck radioOff"><span class="radioContainer radioAnchorTag" id="${id}:_anchor" role="radio" aria-checked="false" aria-labelledby="${id}:_radiolabel" tabindex="0"><span class="radioIcon"><span class="dot"></span></span></span><label id="${id}:_radiolabel" class="radioLabel">${label}</label></span></div>`;
    document
      .getElementById("289:sectionContent")
      ?.insertAdjacentHTML(
        "beforeend",
        `<div class="RCMFormField rcmFormQuestionElement "><label id="912:" for="908:" class="rcmFormQuestionLabel"><span class="requiredField" aria-hidden="true" role="presentation">*</span>&nbsp;Are you enrolled in a co-op program?</label><div class="fieldComponentInput" id="911:_fieldComponentInput"><div id="908:" class="radioGroup" role="radiogroup" aria-labelledby="912:">${radio("909", "Yes")}${radio("910", "No")}</div><div tabindex="-1" role="alert" id="913:" class="rcmValidationMsgArea displayNone"></div></div></div>`,
      );
    // The group checks the one clicked, and unchecks the other.
    for (const id of ["909", "910"]) {
      document.getElementById(`${id}:_radio`)?.addEventListener("click", () => {
        for (const a of document.querySelectorAll("[id$=':_anchor']")) a.setAttribute("aria-checked", "false");
        document.getElementById(`${id}:_anchor`)?.setAttribute("aria-checked", "true");
      });
    }
    const api = createAdapter(successfactors, document, () => URL);
    const field = api
      .getForm()
      .sections.flatMap((x) => x.fields)
      .find((x) => x.id === "job-specific-information.are-you-enrolled-in-a-co-op-program");
    expect(field).toMatchObject({
      label: "Are you enrolled in a co-op program?",
      kind: "radio",
      required: true,
      options: ["Yes", "No"],
      currentValue: null,
    });
    const [yes] = await api.fill([
      { fieldId: "job-specific-information.are-you-enrolled-in-a-co-op-program", value: "Yes" },
    ]);
    expect(yes).toMatchObject({ ok: true, readBack: "Yes" });
    const [miss] = await api.fill([
      { fieldId: "job-specific-information.are-you-enrolled-in-a-co-op-program", value: "Maybe" },
    ]);
    expect(miss).toMatchObject({ ok: false, availableOptions: ["Yes", "No"] });
  });
});

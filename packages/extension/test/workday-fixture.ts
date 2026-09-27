/**
 * A small behavioural imitation of a Workday application step, built from the structure real tenants
 * use (formField-* containers, listbox portals, prompt popups, split dates, drop zones, progress bar).
 * It is not Workday: live verification against real tenants is still required (plan M7 recon).
 */
export function buildWorkdayStep(
  doc: Document,
  opts: { coverUploadsWork?: boolean } = {},
): { submitClicks: () => number } {
  doc.body.innerHTML = `
  <div data-automation-id="applyFlowPage">
    <ol data-automation-id="progressBar">
      <li data-automation-id="progressBarActiveStep"><label>current step 1 of 3</label>My Information</li>
      <li>Application Questions</li>
      <li>Review</li>
    </ol>
    <h2>My Information</h2>
    <div data-automation-id="formField-legalName--firstName">
      <label for="fn">First Name<abbr title="required">*</abbr></label>
      <input id="fn" type="text" aria-required="true">
    </div>
    <div data-automation-id="formField-countryDropdown">
      <label id="cl">Country*</label>
      <button aria-haspopup="listbox" aria-labelledby="cl" aria-controls="lb-country">Select One</button>
    </div>
    <div data-automation-id="formField-source">
      <label>How Did You Hear About Us?*</label>
      <div data-automation-id="multiSelectContainer" id="ms-source"><input type="text" aria-required="true"></div>
      <ul data-automation-id="selectedItemList"></ul>
    </div>
    <div data-automation-id="formField-skills">
      <label>Skills</label>
      <div data-automation-id="multiSelectContainer" id="ms-skills"><input type="text"></div>
      <ul data-automation-id="selectedItemList">
        <li data-automation-id="selectedItem" tabindex="0"><div data-automation-id="promptSelectionLabel">Java</div><div data-automation-id="DELETE_charm" role="button" aria-label="press delete to clear value"></div></li>
        <li data-automation-id="selectedItem" tabindex="0"><div data-automation-id="promptSelectionLabel">COBOL</div><div data-automation-id="DELETE_charm" role="button" aria-label="press delete to clear value"></div></li>
        <li data-automation-id="selectedItem" tabindex="0"><div data-automation-id="promptSelectionLabel">Customer Service</div><div data-automation-id="DELETE_charm" role="button" aria-label="press delete to clear value"></div></li>
        <li data-automation-id="selectedItem" tabindex="0"><div data-automation-id="promptSelectionLabel">Fortran</div></li>
      </ul>
    </div>
    <fieldset>
      <legend>Application Questions</legend>
      <div data-automation-id="formField-previousWorker">
        <fieldset>
          <legend>Have you previously worked for Acme?*</legend>
          <input type="radio" id="pw-yes" name="pw" value="true"><label for="pw-yes">Yes</label>
          <input type="radio" id="pw-no" name="pw" value="false"><label for="pw-no">No</label>
        </fieldset>
      </div>
      <div data-automation-id="formField-agreement">
        <input type="checkbox" id="agree"><label for="agree">I agree to the privacy notice</label>
      </div>
      <div data-automation-id="formField-startDate">
        <label>Available Start Date</label>
        <input aria-label="Month" type="text"><input aria-label="Year" type="text">
      </div>
      <div data-automation-id="formField-resume">
        <label>Resume/CV</label>
        <div data-automation-id="file-upload-drop-zone"><input data-automation-id="file-upload-input-ref" type="file"></div>
        <div data-automation-id="uploaded"></div>
      </div>
      <div data-automation-id="formField-coverLetter">
        <label>Cover Letter</label>
        <div data-automation-id="file-upload-drop-zone"><input id="cl-input" type="file"></div>
        <div id="cl-files">
          <div data-automation-id="file-upload-item"><div data-automation-id="file-upload-item-name">cover.pdf</div><button data-automation-id="delete-file" aria-label="Delete cover.pdf"></button></div>
        </div>
      </div>
    </fieldset>
    <div role="group" id="we" aria-labelledby="we-h">
      <div class="we-row"><h4 id="we-h">Work Experience 1</h4>
        <div data-automation-id="formField-jobTitle"><label>Job Title*</label><input type="text"></div>
      </div>
      <button data-automation-id="Add" aria-label="Add Work Experience">Add Another</button>
    </div>
    <div data-automation-id="pageFooter">
      <button data-automation-id="bottom-navigation-next-button">Save and Continue</button>
    </div>
  </div>`;

  // Dropdown: clicking the button renders a listbox portal at the end of <body>.
  const button = doc.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]') as HTMLButtonElement;
  button.addEventListener("click", () => {
    const existing = doc.getElementById("lb-country");
    if (existing) {
      existing.remove();
      button.setAttribute("aria-expanded", "false");
      return;
    }
    const ul = doc.createElement("ul");
    ul.id = "lb-country";
    ul.setAttribute("role", "listbox");
    for (const c of ["Canada", "United States of America", "United Kingdom"]) {
      const li = doc.createElement("li");
      li.setAttribute("role", "option");
      li.innerHTML = `<div>${c}</div>`;
      li.addEventListener("click", () => {
        button.textContent = c;
        ul.remove();
        button.setAttribute("aria-expanded", "false");
      });
      ul.append(li);
    }
    doc.body.append(ul);
    button.setAttribute("aria-expanded", "true");
  });
  button.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") doc.getElementById("lb-country")?.remove();
  });

  // Prompt: Enter in the input opens a popup with matching options (and a nested category).
  const sourceInput = doc.querySelector<HTMLInputElement>("#ms-source input") as HTMLInputElement;
  const selected = doc.querySelector(
    '[data-automation-id="formField-source"] [data-automation-id="selectedItemList"]',
  ) as HTMLElement;
  const openPrompt = (items: string[], nested = false) => {
    doc.querySelector('[data-automation-widget="wd-popup"]')?.remove();
    const popup = doc.createElement("div");
    popup.setAttribute("data-automation-widget", "wd-popup");
    const inner = doc.createElement("div");
    inner.setAttribute("data-associated-widget", "ms-source");
    popup.append(inner);
    for (const item of items) {
      const opt = doc.createElement("div");
      opt.setAttribute("data-automation-id", "promptOption");
      if (!nested && item === "Job Board") opt.setAttribute("aria-haspopup", "true");
      opt.textContent = item;
      opt.addEventListener("click", () => {
        if (!nested && item === "Job Board") {
          openPrompt(["LinkedIn", "Indeed"], true);
          return;
        }
        const li = doc.createElement("li");
        li.textContent = item;
        selected.append(li);
        popup.remove();
      });
      inner.append(opt);
    }
    doc.body.append(popup);
  };
  sourceInput.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      const q = sourceInput.value.toLowerCase();
      openPrompt(["Company Website", "Employee Referral", "Job Board"].filter((o) => o.toLowerCase().includes(q)));
    }
    if ((e as KeyboardEvent).key === "Escape") doc.querySelector('[data-automation-widget="wd-popup"]')?.remove();
  });
  sourceInput.addEventListener("click", () => openPrompt(["Company Website", "Employee Referral", "Job Board"]));

  // Radios and checkbox: clicking an input toggles it natively in jsdom; mirror aria-checked.
  for (const input of doc.querySelectorAll<HTMLInputElement>('input[type="radio"], input[type="checkbox"]')) {
    input.addEventListener("change", () => {
      for (const r of doc.querySelectorAll<HTMLInputElement>(`input[name="${input.name}"]`)) {
        r.setAttribute("aria-checked", String(r.checked));
      }
    });
  }

  // Upload: a change on the file input shows the file name.
  const fileInput = doc.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;
  fileInput.addEventListener("change", () => {
    const name = fileInput.files?.[0]?.name;
    if (name) {
      const shown = doc.querySelector('[data-automation-id="uploaded"]') as HTMLElement;
      shown.innerHTML = `<div data-automation-id="file-upload-item-name">${name}</div>`;
    }
  });

  // Skills pills: the delete charm removes a pill; a focused pill also goes with Delete/Backspace
  // ("Fortran" has no charm, so only the keyboard removes it).
  doc.addEventListener("click", (e) => {
    const charm = (e.target as Element).closest?.('[data-automation-id="DELETE_charm"]');
    charm?.closest("li")?.remove();
  });
  for (const pill of doc.querySelectorAll<HTMLElement>('[data-automation-id="selectedItem"]')) {
    pill.addEventListener("keydown", (e) => {
      if (["Delete", "Backspace"].includes((e as KeyboardEvent).key)) pill.remove();
    });
  }

  // Cover letter: holds a file left from a previous application. Deleting asks for confirmation;
  // uploads append a new row (unless opts.coverUploadsWork is false).
  const clFiles = doc.getElementById("cl-files") as HTMLElement;
  clFiles.addEventListener("click", (e) => {
    const del = (e.target as Element).closest?.('[data-automation-id="delete-file"]');
    const row = del?.closest('[data-automation-id="file-upload-item"]');
    if (!row) return;
    const dialog = doc.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.innerHTML = "<p>Delete this file?</p><button>Delete</button><button>Cancel</button>";
    dialog.addEventListener("click", (ev) => {
      if ((ev.target as Element).textContent === "Delete") row.remove();
      dialog.remove();
    });
    doc.body.append(dialog);
  });
  const clInput = doc.getElementById("cl-input") as HTMLInputElement;
  clInput.addEventListener("change", () => {
    const name = clInput.files?.[0]?.name;
    if (!name || opts.coverUploadsWork === false) return;
    const row = doc.createElement("div");
    row.setAttribute("data-automation-id", "file-upload-item");
    row.innerHTML = `<div data-automation-id="file-upload-item-name">${name}</div><button data-automation-id="delete-file" aria-label="Delete ${name}"></button>`;
    clFiles.append(row);
  });

  // Repeatable: Add clones the work experience row.
  let rows = 1;
  doc.querySelector('[data-automation-id="Add"]')?.addEventListener("click", () => {
    rows++;
    const row = doc.createElement("div");
    row.className = "we-row";
    row.innerHTML = `<h4>Work Experience ${rows}</h4><div data-automation-id="formField-jobTitle"><label>Job Title*</label><input type="text"></div>`;
    doc.getElementById("we")?.insertBefore(row, doc.querySelector('[data-automation-id="Add"]'));
  });

  // Next: requires first name; moves to Review where the forward button becomes Submit.
  let submitClicks = 0;
  const next = doc.querySelector('[data-automation-id="bottom-navigation-next-button"]') as HTMLButtonElement;
  next.addEventListener("click", () => {
    if (next.textContent === "Submit") {
      submitClicks++;
      return;
    }
    const fn = doc.getElementById("fn") as HTMLInputElement;
    if (!fn.value) {
      const err = doc.createElement("div");
      err.setAttribute("data-automation-id", "errorMessage");
      err.textContent = "Error: First Name is required";
      doc.querySelector('[data-automation-id="formField-legalName--firstName"]')?.append(err);
      return;
    }
    const bar = doc.querySelector('[data-automation-id="progressBar"]') as HTMLElement;
    bar.innerHTML = `<li>My Information</li><li>Application Questions</li><li data-automation-id="progressBarActiveStep">Review</li>`;
    for (const f of doc.querySelectorAll('[data-automation-id^="formField-"]')) f.remove();
    next.textContent = "Submit";
  });

  return { submitClicks: () => submitClicks };
}

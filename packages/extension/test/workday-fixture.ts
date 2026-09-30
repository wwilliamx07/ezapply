/**
 * jsdom lacks DataTransfer and DragEvent, which uploads use; the adapter only needs items.add + files, and a
 * drop event that carries them. Installed on the window the adapter reads its constructors from.
 */
export function installDomShims(win: Window): void {
  const w = win as unknown as Record<string, unknown> & { Event: typeof Event };
  w.DataTransfer = class FakeDataTransfer {
    private list: File[] = [];
    items = { add: (f: File) => this.list.push(f) };
    get files() {
      const l = this.list;
      return Object.assign([...l], { item: (i: number) => l[i] ?? null }) as unknown as FileList;
    }
  };
  w.DragEvent = class extends w.Event {
    dataTransfer: unknown;
    constructor(type: string, init: EventInit & { dataTransfer?: unknown } = {}) {
      super(type, init);
      this.dataTransfer = init.dataTransfer;
    }
  };
}

/** How long a closed dropdown listbox stays on screen while it animates away. */
export const LISTBOX_LINGER_MS = 150;

/**
 * A small behavioural imitation of a Workday application step, built from the structure real tenants
 * use (formField-* containers, listbox portals, prompt popups, split dates, drop zones, progress bar).
 * It is not Workday: live verification against real tenants is still required (plan M7 recon). The
 * companion's e2e tests drive it through the real adapter too, so there is one model of a Workday step.
 */
export interface StepOptions {
  coverUploadsWork?: boolean;
  dateNeedsSecondPass?: boolean;
  /**
   * Start Date as Workday's split date widget: each part a spinbutton that takes digits in keydown and shows
   * its value in a display element; "stuck" ignores synthetic keys, so only the input's value changes.
   */
  dateWidget?: "keys" | "stuck";
  /** Every step in the progress bar is titled "Application", as on some live tenants. */
  sameStepTitles?: boolean;
  /**
   * Dropdowns as seen live: the button has no aria-expanded, Escape doesn't close an open listbox, and a press
   * anywhere outside it (its own button included) only closes it: the press itself is swallowed.
   */
  liveDropdowns?: boolean;
  /**
   * A dropdown whose list was closed without a choice ignores the next press on its button, which is what two
   * live runs showed: the first open after list_options or a miss failed, the next attempt worked.
   */
  dismissedIgnoresNextPress?: boolean;
  /**
   * Next goes from the first step to an "Application Questions" step whose progress bar changes at once and
   * whose field renders this many ms later, as live steps did; its Next goes on to Review.
   */
  questionsStepRenderMs?: number;
}

/** The live-dropdown listeners each document was given by its last build. */
const liveListeners = new WeakMap<Document, AbortController>();

/** Search delay of the Skills prompt, which shows "No Items." until its results arrive. */
export const SKILLS_SEARCH_MS = 400;

const SKILLS = [
  "Python (Programming Language)",
  "Python Development",
  "Structured Query Language (SQL)",
  "U-SQL",
  "Nginx Web Server",
  "NGINX Plus",
  "JavaScript",
  "TypeScript",
  "C++ Programming Language",
  "C (Programming Language)",
  "React.js",
  "React Native",
];

export function buildWorkdayStep(doc: Document, opts: StepOptions = {}): { submitClicks: () => number } {
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
      <div data-automation-id="formField-degreeLevel">
        <label id="dl">Degree Level*</label>
        <button aria-haspopup="listbox" aria-labelledby="dl">Select One</button>
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
        <button data-automation-id="panel-set-delete-button" aria-label="Delete Work Experience 1">Delete</button>
        <div data-automation-id="formField-jobTitle"><label>Job Title*</label><input type="text"></div>
      </div>
      <button data-automation-id="Add" aria-label="Add Work Experience">Add Another</button>
    </div>
    <div><div><h3>Websites</h3></div><button data-automation-id="add-button">Add</button></div>
    <div data-automation-id="pageFooter">
      <button data-automation-id="bottom-navigation-previous-button" hidden>Back</button>
      <button data-automation-id="bottom-navigation-next-button">Save and Continue</button>
    </div>
  </div>`;

  // Dropdowns: clicking the button renders a listbox portal at the end of <body>. A closed listbox stays on
  // screen for LISTBOX_LINGER_MS while it animates away, as on live Workday. Country's button names its
  // listbox with aria-controls; Degree Level's doesn't (live buttons don't).
  const live = opts.liveDropdowns === true;
  let current: { ul: HTMLElement; close: () => void } | null = null;
  // The page-wide listeners of an earlier build on this document go, or its open list would swallow presses.
  liveListeners.get(doc)?.abort();
  if (live) {
    const listeners = new AbortController();
    liveListeners.set(doc, listeners);
    const { signal } = listeners;
    let swallow = false;
    doc.addEventListener(
      "mousedown",
      (e) => {
        if (current && !current.ul.contains(e.target as Node)) {
          current.close();
          swallow = true;
        }
      },
      { capture: true, signal },
    );
    doc.addEventListener(
      "click",
      (e) => {
        if (!swallow) return;
        swallow = false;
        e.stopImmediatePropagation();
      },
      { capture: true, signal },
    );
  }
  const dropdown = (automationId: string, options: string[], listId?: string) => {
    const button = doc.querySelector<HTMLButtonElement>(
      `[data-automation-id="${automationId}"] button[aria-haspopup="listbox"]`,
    ) as HTMLButtonElement;
    let open: HTMLElement | null = null;
    let dismissed = false;
    const close = (chose = false) => {
      const ul = open;
      open = null;
      dismissed = !chose;
      if (current?.ul === ul) current = null;
      if (!live) button.setAttribute("aria-expanded", "false");
      setTimeout(() => ul?.remove(), LISTBOX_LINGER_MS);
    };
    button.addEventListener("click", () => {
      if (open) return close();
      if (opts.dismissedIgnoresNextPress && dismissed) {
        dismissed = false;
        return;
      }
      const ul = doc.createElement("ul");
      if (listId) ul.id = listId;
      ul.setAttribute("role", "listbox");
      for (const c of options) {
        const li = doc.createElement("li");
        li.setAttribute("role", "option");
        li.innerHTML = `<div>${c}</div>`;
        li.addEventListener("click", () => {
          button.textContent = c;
          close(true);
        });
        ul.append(li);
      }
      ul.addEventListener("keydown", (e) => {
        if (!live && (e as KeyboardEvent).key === "Escape" && open === ul) close();
      });
      doc.body.append(ul);
      open = ul;
      current = { ul, close };
      if (!live) button.setAttribute("aria-expanded", "true");
    });
    button.addEventListener("keydown", (e) => {
      if (!live && (e as KeyboardEvent).key === "Escape" && open) close();
    });
  };
  dropdown("formField-countryDropdown", ["Canada", "United States of America", "United Kingdom"], "lb-country");
  dropdown("formField-degreeLevel", ["Undergraduate", "Masters", "Ph.D"]);

  // Split date: with opts.dateNeedsSecondPass, Start Date shows a "required" error (as after a failed Next)
  // that only clears on the second entry of its month, as seen live. An entry is an input event that leaves
  // the month with two digits (typing "1" then "2" is one entry).
  if (opts.dateNeedsSecondPass) {
    const date = doc.querySelector('[data-automation-id="formField-startDate"]') as HTMLElement;
    const err = doc.createElement("div");
    err.setAttribute("data-automation-id", "errorMessage");
    err.textContent = "Error: The field Available Start Date is required and must have a value.";
    date.append(err);
    let entries = 0;
    const month = date.querySelector('input[aria-label="Month"]') as HTMLInputElement;
    month.addEventListener("input", () => {
      if (month.value.length === 2 && ++entries === 2) err.remove();
    });
  }

  if (opts.dateWidget) {
    const date = doc.querySelector('[data-automation-id="formField-startDate"]') as HTMLElement;
    date.innerHTML = `<label>Available Start Date</label>
      <div data-automation-id="dateSectionMonth"><div data-automation-id="dateSectionMonth-display">MM</div><input data-automation-id="dateSectionMonth-input" aria-label="Month" role="spinbutton" type="text"></div>
      <div data-automation-id="dateSectionYear"><div data-automation-id="dateSectionYear-display">YYYY</div><input data-automation-id="dateSectionYear-input" aria-label="Year" role="spinbutton" type="text"></div>`;
    for (const input of date.querySelectorAll<HTMLInputElement>("input")) {
      const display = input.previousElementSibling as HTMLElement;
      const max = input.getAttribute("aria-label") === "Year" ? 4 : 2;
      let typed = "";
      input.addEventListener("focus", () => {
        typed = "";
      });
      input.addEventListener("keydown", (e) => {
        if (!/^\d$/.test(e.key) || opts.dateWidget === "stuck") return;
        e.preventDefault();
        typed = (typed + e.key).slice(-max);
        display.textContent = typed;
        input.value = typed;
      });
    }
  }

  // Skills prompt: Enter shows "No Items." at once and the results SKILLS_SEARCH_MS later, each option as
  // promptLeafNode around promptOption (as live), so both option hooks match it.
  const skillsInput = doc.querySelector<HTMLInputElement>("#ms-skills input") as HTMLInputElement;
  const skillsSelected = doc.querySelector(
    '[data-automation-id="formField-skills"] [data-automation-id="selectedItemList"]',
  ) as HTMLElement;
  const skillsPopup = (labels: string[]) => {
    doc.querySelector("#skills-popup")?.remove();
    const popup = doc.createElement("div");
    popup.id = "skills-popup";
    popup.setAttribute("data-automation-widget", "wd-popup");
    const inner = doc.createElement("div");
    inner.setAttribute("data-associated-widget", "ms-skills");
    popup.append(inner);
    for (const label of labels.length ? labels : ["No Items."]) {
      const leaf = doc.createElement("div");
      leaf.setAttribute("data-automation-id", "promptLeafNode");
      leaf.innerHTML = `<div data-automation-id="promptOption">${label}</div>`;
      if (labels.length) {
        leaf.addEventListener("click", () => {
          const li = doc.createElement("li");
          li.setAttribute("data-automation-id", "selectedItem");
          li.innerHTML = `<div data-automation-id="promptSelectionLabel">${label}</div>`;
          skillsSelected.append(li);
          popup.remove();
        });
      }
      inner.append(leaf);
    }
    doc.body.append(popup);
  };
  skillsInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") doc.querySelector("#skills-popup")?.remove();
    if (e.key !== "Enter") return;
    const q = skillsInput.value.toLowerCase();
    skillsPopup([]);
    setTimeout(() => skillsPopup(SKILLS.filter((s) => s.toLowerCase().includes(q))), SKILLS_SEARCH_MS);
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
      // Live Workday announces the upload in an alert region, like an error.
      shown.innerHTML = `<div data-automation-id="file-upload-item-name">${name}</div><div role="alert">${name} successfully uploaded</div>`;
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

  // Repeatable: Add appends a work experience row; a row's Delete asks for confirmation, removes it, and
  // renumbers the rest (as Workday does, so later rows' field ids change).
  const renumber = () => {
    [...doc.querySelectorAll(".we-row")].forEach((row, i) => {
      const h = row.querySelector("h4") as HTMLElement;
      h.textContent = `Work Experience ${i + 1}`;
      row.querySelector("button")?.setAttribute("aria-label", `Delete Work Experience ${i + 1}`);
    });
  };
  doc.querySelector('[data-automation-id="Add"]')?.addEventListener("click", () => {
    const row = doc.createElement("div");
    row.className = "we-row";
    row.innerHTML = `<h4></h4><button data-automation-id="panel-set-delete-button">Delete</button><div data-automation-id="formField-jobTitle"><label>Job Title*</label><input type="text"></div>`;
    doc.getElementById("we")?.insertBefore(row, doc.querySelector('[data-automation-id="Add"]'));
    renumber();
  });
  doc.getElementById("we")?.addEventListener("click", (e) => {
    const row = (e.target as Element).closest?.('[data-automation-id="panel-set-delete-button"]')?.closest(".we-row");
    if (!row) return;
    const dialog = doc.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.innerHTML = "<p>Delete this Work Experience?</p><button>Delete</button><button>Cancel</button>";
    dialog.addEventListener("click", (ev) => {
      if ((ev.target as Element).textContent === "Delete") {
        row.remove();
        renumber();
      }
      dialog.remove();
    });
    doc.body.append(dialog);
  });

  // Next: requires first name; moves to Review where the forward button becomes Submit and Back appears.
  // Back returns to the step with its entries kept (Workday saved them when Next was pressed).
  let submitClicks = 0;
  const next = doc.querySelector('[data-automation-id="bottom-navigation-next-button"]') as HTMLButtonElement;
  const back = doc.querySelector('[data-automation-id="bottom-navigation-previous-button"]') as HTMLButtonElement;
  const bar = doc.querySelector('[data-automation-id="progressBar"]') as HTMLElement;
  const title = (t: string) => (opts.sameStepTitles ? "Application" : t);
  if (opts.sameStepTitles) {
    bar.innerHTML = `<li data-automation-id="progressBarActiveStep"><label>current step 1 of 3</label>Application</li><li>Application</li><li>Application</li>`;
  }
  const firstStepBar = bar.innerHTML;
  let onQuestions = false;
  back.addEventListener("click", () => {
    doc.querySelector('[data-automation-id="formField-coopTerms"]')?.remove();
    onQuestions = false;
    bar.innerHTML = firstStepBar;
    for (const f of doc.querySelectorAll<HTMLElement>('[data-automation-id^="formField-"]')) f.hidden = false;
    next.textContent = "Save and Continue";
    back.hidden = true;
  });
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
    for (const f of doc.querySelectorAll<HTMLElement>('[data-automation-id^="formField-"]')) f.hidden = true;
    back.hidden = false;
    if (opts.questionsStepRenderMs !== undefined && !onQuestions) {
      onQuestions = true;
      bar.innerHTML = `<li>${title("My Information")}</li><li data-automation-id="progressBarActiveStep">${title("Application Questions")}</li><li>${title("Review")}</li>`;
      setTimeout(() => {
        const q = doc.createElement("div");
        q.setAttribute("data-automation-id", "formField-coopTerms");
        q.innerHTML = '<label>Co-op terms completed</label><input type="text">';
        doc.querySelector('[data-automation-id="pageFooter"]')?.before(q);
      }, opts.questionsStepRenderMs);
      return;
    }
    bar.innerHTML = `<li>${title("My Information")}</li><li>${title("Application Questions")}</li><li data-automation-id="progressBarActiveStep">${title("Review")}</li>`;
    next.textContent = "Submit";
  });

  return { submitClicks: () => submitClicks };
}

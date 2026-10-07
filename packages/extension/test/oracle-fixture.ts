/**
 * A small behavioural imitation of an Oracle Recruiting Cloud application, built from the markup of a live
 * tenant (test/fixtures/live/oracle-apply.html) and the Candidate Experience's own component templates:
 * `.input-row` rows, cx-select comboboxes (a grid of options under `#<id>-listbox`, searching as you type,
 * clearing on Escape while closed, putting back unaccepted text on blur), cx-select-pills (toggle buttons),
 * hidden native radios and checkboxes, the month/day/year date lists, attachment buttons, inline item forms
 * with a Save button, saved tiles and timeline entries, and the pagination. It is not Oracle: live
 * verification is still required.
 */
export interface OracleOptions {
  /** The multi-page flow: one section at a time, Next and Previous; Submit on the last. Default: single page. */
  multiPage?: boolean;
  /** A returning candidate: "Welcome Back… Use My Profile" over the form. */
  profileChoice?: boolean;
  /** A resume already attached from the candidate's profile. */
  resumeOnFile?: string;
  /**
   * The postal code list as seen live: it opens on nothing, then "No results found" while its first page loads;
   * typing re-renders that unfiltered page at once and searches `POSTAL_SEARCH_DELAY_MS` later; closing the list
   * drops a search not yet run; and the widget keeps the last text typed, searching only when the text changes.
   */
  liveSearch?: boolean;
}

/** With `liveSearch`: how long the postal code list waits after typing before it searches. */
export const POSTAL_SEARCH_DELAY_MS = 300;

const COUNTRIES = ["Canada", "United States", "United Kingdom", "Finland", "France"];
/** As live: the list labels a city with its province, and the field shows the city alone once chosen. */
const CITIES: Record<string, string[]> = {
  Canada: ["Ottawa, Ontario", "Toronto, Ontario", "Montreal, Quebec", "Kanata, Ontario"],
  "United States": ["Boston, Massachusetts", "Dallas, Texas"],
};
/** The server returns the first page when the list opens, and finds a code only by the code itself. */
const POSTAL_CODES = ["K2K 3E7, Kanata, Ontario", "K2K 3E8, Kanata, Ontario", "K2K 3E9, Kanata, Ontario"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const YEARS = Array.from({ length: 12 }, (_, i) => String(2020 + i));
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));
const LANGUAGES = ["English", "French", "Finnish", "German"];

/** How long the city list takes to search (it asks the server). */
export const CITY_SEARCH_MS = 150;

const row = (id: string, label: string, control: string, required = false) => `
  <div class="input-row input-row--text">
    <label class="input-row__label${required ? " input-row__label--required" : ""}" for="${id}" aria-labelledby="labelText-${id} instructionsText-${id}">
      <span class="input-row__linebreak" id="labelText-${id}">${label}</span>${required ? '<span class="input-row__label--required-star"></span>' : ""}
    </label>
    <div class="input-row__control-container">${control}</div>
  </div>`;

const text = (id: string, name: string, label: string, required = false, extra = "") =>
  row(
    id,
    label,
    `<input class="input-row__control" id="${id}" name="${name}" ${required ? 'aria-required="true"' : ""} ${extra}>`,
    required,
  );

const combo = (id: string, name: string, label: string, required = false) => `
  <div class="input-row input-row--has-picker">
    <label class="input-row__label cx-select__label${required ? " input-row__label--required" : ""}" for="${id}">
      <span class="input-row__label-text">${label}${required ? '<span class="cx-select__label--required">*</span>' : ""}</span>
    </label>
    <div class="input-row__control-container reset-z-index">${comboWidget(id, name)}</div>
  </div>`;

const comboWidget = (id: string, name: string) => `
  <div class="cx-select-container"><div class="input-field-container">
    <div class="input-field-container__left">
      <input autocomplete="none" name="${name}" id="${id}" type="text" role="combobox" aria-haspopup="grid" aria-controls="${id}-listbox" aria-expanded="false" class="cx-select-input">
    </div>
    <div class="input-field-container__right">
      <button type="button" id="${id}-toggle-button" tabindex="-1" aria-expanded="false" aria-controls="${id}-listbox" class="icon-dropdown-arrow"></button>
    </div>
    <div class="cx-select__listbox-slot"></div>
  </div></div>`;

const pills = (qa: string, id: string, label: string, options: string[], multi = false, required = false) => `
  <div class="input-row input-row--has-picker">
    <label class="input-row__label${required ? " input-row__label--required" : ""}" for="${id}"><span class="input-row__linebreak" id="labelText-${id}">${label}</span></label>
    <div class="input-row__control-container reset-z-index" data-qa="${qa}">
      <ul role="list" aria-label="${label}" class="cx-select-pills-container">
        ${options
          .map(
            (o) => `<li role="listitem"><button type="button" class="cx-select-pill-section" aria-pressed="false">
              <span class="cx-select-pill-name"> ${o}</span>${multi ? '<span class="cx-select-pill__plus-icon"></span>' : ""}</button></li>`,
          )
          .join("")}
      </ul>
    </div>
  </div>`;

const radios = (id: string, name: string, label: string, options: [string, string][], required = false) => `
  <div class="input-row input-row--radiogroup" role="radiogroup" aria-labelledby="${id}-label">
    <label class="input-row__label${required ? " input-row__label--required" : ""}" id="${id}-label"><span class="input-row__linebreak" id="labelText-${id}">${label}</span></label>
    <div class="input-row__control-container">
      ${options
        .map(
          ([value, text]) => `
        <input type="radio" class="input-row__hidden-control" value="${value}" id="${id}-${value}" name="${name}" ${required ? 'required="true"' : ""} aria-labelledby="label-${id}-${value}">
        <label class="apply-flow-input-radio" for="${id}-${value}"><span class="apply-flow-input-radio__label" id="label-${id}-${value}">${text}</span></label>`,
        )
        .join("")}
    </div>
  </div>`;

const upload = (tag: string, id: string, what: string, required = false) => `
  <div class="file-upload-wrapper__section"><${tag}><div>
    <div class="attachment-upload-button attachment-upload-button--waiting" role="application">
      <div class="attachment-upload-button__container">
        <div class="attachment-upload-button__drag-and-drop"><span class="attachment-upload-button__drag-and-drop-label${required ? " attachment-upload-button__drag-and-drop-label--required" : ""}"><span>Drop ${what} Here</span></span></div>
        <div class="attachment-upload-button__upload-button"><div class="file-form-element">
          <input type="file" class="file-form-element__input upload-button" id="${id}" name="attachment-upload" ${required ? 'aria-required="true"' : ""}>
          <label class="file-form-element__label" for="${id}"><span>Upload ${what}</span></label>
        </div></div>
      </div>
    </div>
  </div></${tag}></div>`;

const block = (id: string, title: string, body: string, cls = "") => `
  <li><apply-flow-block id="block-${id}"><div class="apply-flow-block ${cls}">
    <div class="apply-flow-block__header"><h3 class="apply-flow-block__title"><span>${title}</span></h3></div>
    <div class="apply-flow-block__form-list" role="region">${body}</div>
  </div></apply-flow-block></li>`;

const section = (n: number, title: string, blocks: string) => `
  <apply-flow-section id="section-${n}"><div class="apply-flow-section" data-section-number="${n}">
    <h2 class="apply-flow-section__trainstop-name">${title}</h2>
    <ul class="apply-flow-page-list">${blocks}</ul>
  </div></apply-flow-section>`;

export function buildOracleApplication(doc: Document, opts: OracleOptions = {}) {
  let submitClicks = 0;
  doc.body.innerHTML = `
  <div class="app">
    <h1 class="ui-helper-hidden-accessible">Firmware Engineer application, step 1 of 3</h1>
    <main id="main"><section class="apply-flow__content-container">
      <form class="apply-flow__content apply-flow__content-form"><div class="apply-flow-page">
        <apply-flow-section id="presection-1"><div class="apply-flow-section" data-section-number="1"><ul class="apply-flow-page-list">
          ${block("import", "Import your profile", '<div class="apply-flow-profile-import"></div>')}
        </ul></div></apply-flow-section>
        ${section(
          1,
          "Personal Info",
          block(
            "resume",
            "Resume and URLs",
            `<div class="file-upload-wrapper">
              ${upload("resume-upload-button", "attachment-upload-4", "Resume", true)}
              ${upload("cover-letter-upload-button", "attachment-upload-5", "Cover Letter")}
            </div>
            <div class="candidate-links">${text("siteLink-1-7", "siteLink-1", "Link 1", false, 'type="url"')}
              <button type="button" class="candidate-links__add-link"><span>Add Another Link</span></button></div>`,
          ) +
            block(
              "contact",
              "Contact Information",
              `${text("lastName-39", "lastName", "Last Name", true)}${text("firstName-40", "firstName", "First Name", true)}
              ${pills("title", "title-41", "Title", ["Miss", "Mr.", "Mrs.", "Ms."])}
              <div class="input-row communication-channel__email">
                ${text("email-43", "email", "Email Address", false, 'type="email" readonly="readonly" value="jo@example.com"')}
              </div>
              <div class="input-row input-row--has-picker">
                <label class="input-row__label input-row__label--required" for="country-codes-dropdownphoneNumber"><span class="input-row__linebreak" id="labelText-phoneNumber-44">Phone Number</span></label>
                <div class="input-row__control-container"><div class="input-row-composite__inputs phone-row" role="group">
                  <div class="input-row-composite__input phone-row__prefix">${comboWidget("country-codes-dropdownphoneNumber", "phoneNumber")}</div>
                  <div class="input-row-composite__input phone-row__number"><input type="tel" class="input-row__control phone-row__input" aria-label="Phone Number" aria-required="true"></div>
                </div></div>
              </div>`,
            ) +
            block(
              "address",
              "Address",
              `${combo("country-30", "country", "Country", true)}${text("addressLine1-31", "addressLine1", "Street and House Number", true)}${combo("city-33", "city", "City", true)}${combo("postalCode-36", "postalCode", "Postal Code", true)}`,
            ),
        )}
        ${section(
          2,
          "Job Application Questions",
          block(
            "questions",
            "Application Questions",
            `${pills("300002080504910", "300002080504910-15", "Do you require any accommodations?", ["Yes", "No"], false, true)}
            ${radios(
              "300000383851644-23",
              "300000383851644-23",
              "Are you legally authorized to work in Canada?",
              [
                ["300002038062960", "Yes"],
                ["300002038062961", "No"],
              ],
              true,
            )}
            ${row("300000008694884-20", "Number of co-op terms completed", '<textarea class="input-row__control" id="300000008694884-20" name="300000008694884" required="true"></textarea><textarea class="input-row__control input-row__control--helper" tabindex="-1"></textarea>', true)}
            <div class="datepicker-row input-row input-row--has-picker">
              <label class="input-row__label input-row__label--required" for="300000392474837-24"><span class="input-row__linebreak" id="labelText-300000392474837-24">Expected graduation date</span></label>
              <div class="input-row__control-container"><div class="input-row-composite__inputs">
                <div class="input-row-composite__input datepicker-row__input datepicker-row__input--month">${comboWidget("month-300000392474837-24", "300000392474837")}</div>
                <div class="input-row-composite__input datepicker-row__input datepicker-row__input--day">${comboWidget("day-300000392474837-24", "300000392474837")}</div>
                <div class="input-row-composite__input datepicker-row__input datepicker-row__input--year">${comboWidget("year-300000392474837-24", "300000392474837")}</div>
              </div></div>
            </div>
            ${pills("300009", "300009-30", "Which areas interest you?", ["Firmware", "DSP", "Hardware", "Test"], true)}`,
          ) +
            block(
              "history",
              "Work and Education History",
              `<div class="timeline-container">
                <button id="timeline-add-experience-button" type="button" class="work-and-education-timeline-add-button apply-flow-profile-item-button apply-flow-profile-item-button--add"><span class="apply-flow-profile-item-button__label">Add Experience</span></button>
                <div class="beautiful-timeline">
                  <div class="beautiful-timeline__column beautiful-timeline__column--left">
                    <div class="beautiful-timeline-item" tabindex="0"><div class="beautiful-timeline-item__content"><div class="beautiful-timeline-item__info">
                      <span class="beautiful-timeline-item__title">Acme Corp</span><span class="beautiful-timeline-item__subtitle">Intern</span>
                    </div></div></div>
                  </div>
                  <div class="beautiful-timeline__column beautiful-timeline__column--right"></div>
                </div>
              </div>`,
              "apply-flow-block--work-and-education-timeline",
            ) +
            block(
              "languages",
              "Languages",
              `<div class="profile-item-container"><div class="standard-apply-flow-profile-item">
                <div class="tiles"></div>
                <div class="profile-add-item"><button type="button" class="button apply-flow-profile-item-tile__new-tile"><span class="button__label">Add Language</span></button></div>
                <div class="inline-form"></div>
              </div></div>`,
              "apply-flow-block--unique-tile-profile-items",
            ),
        )}
        ${section(
          3,
          "More About You",
          block(
            "docs",
            "Additional Documents",
            `<div class="file-upload-wrapper">${upload("misc-attachment-upload-button", "attachment-upload-9", "attachment")}</div><div class="misc-attachment-list"></div>`,
            "apply-flow-block--misc-attachments",
          ) +
            block(
              "agreements",
              "Agreements",
              `<job-alerts-opt-in class="apply-flow-agreements__row">
                <input type="checkbox" class="input-row__hidden-control" id="job-alerts-checkbox">
                <label class="apply-flow-input-checkbox" for="job-alerts-checkbox"><span class="apply-flow-input-checkbox__label">I agree to receive updates about new job opportunities.</span></label>
              </job-alerts-opt-in>`,
              "apply-flow-block--agreements",
            ),
        )}
      </div></form>
      <div class="apply-flow-pagination"><div class="apply-flow-pagination__buttons"></div></div>
    </section></main>
    <div class="notifications" role="alert"></div>
    <oj-dialog class="app-dialog profile-selection-overlay" role="dialog" ${opts.profileChoice ? "" : 'style="display: none;"'}>
      <div class="profile-selection-overlay__main">
        <h2>Welcome Back</h2>
        <button class="button app-dialog__footer-button">Use My Profile</button>
        <button class="button app-dialog__footer-button import-indeed-button">Import Profile from Indeed</button>
      </div>
    </oj-dialog>
  </div>`;

  const $ = <T extends HTMLElement>(sel: string) => doc.querySelector(sel) as T;
  const w = doc.defaultView as Window & typeof globalThis;

  // ---- cx-select ----
  interface Combo {
    input: HTMLInputElement;
    /** The chosen option's label in the list. */
    selected: string | null;
  }
  interface ComboOptions {
    /** Search on the server: results arrive after this long. */
    searchMs?: number;
    /** What the field shows once an option is chosen (default: its label). */
    display?: (label: string) => string;
    /** Which options a search term finds (default: those containing it). */
    finds?: (label: string, term: string) => boolean;
    /** The options the list shows when it opens (default: all of them). */
    firstPage?: (all: string[]) => string[];
    chosen?: (label: string) => void;
    /** Opening the list the first time re-renders the widget: a new input replaces this one (seen live). */
    rerenderOnOpen?: boolean;
    /** `liveSearch`'s behaviour, searching this long after the text changes. */
    liveSearchMs?: number;
  }
  const combos = new Map<string, Combo>();
  const wireCombo = (id: string, source: () => string[], o: ComboOptions = {}) => {
    const input = doc.getElementById(id) as HTMLInputElement;
    const slot = input.closest(".cx-select-container")?.querySelector(".cx-select__listbox-slot") as HTMLElement;
    const state: Combo = { input, selected: null };
    combos.set(id, state);
    const display = o.display ?? ((l: string) => l);
    const shown = () => (state.selected === null ? "" : display(state.selected));
    const row = input.closest(".input-row") as HTMLElement | null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastTerm = "";
    const close = () => {
      if (o.liveSearchMs) clearTimeout(timer);
      slot.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
    };
    const render = (options: string[], busy = false) => {
      input.setAttribute("aria-expanded", "true");
      slot.innerHTML = `<div class="cx-select__listbox"><div class="cx-select__list" role="${busy || options.length ? "grid" : "status"}" id="${id}-listbox" aria-busy="${busy}">
        ${
          busy
            ? '<div class="cx-select__list-item--loading"></div>'
            : options.length
              ? options
                  .map(
                    (o, i) =>
                      `<div role="row"><div tabindex="-1" role="gridcell" id="${id}-listitem-${i}" class="cx-select__list-item"><div class="cx-select__list-item-container"><span class="cx-select__list-item--content">${o}</span></div></div></div>`,
                  )
                  .join("")
              : '<div class="cx-select__list-item--no-results">No results found</div>'
        }</div></div>`;
      for (const cell of slot.querySelectorAll<HTMLElement>("[role=gridcell]")) {
        cell.addEventListener("click", () => {
          state.selected = cell.textContent?.trim() ?? "";
          input.value = shown();
          close();
          // The row's "required" error goes a moment after the choice, when the page validates again.
          setTimeout(() => row?.querySelector(".input-row__validation")?.remove(), 200);
          o.chosen?.(state.selected);
        });
      }
    };
    const firstPage = () => (o.firstPage ?? ((a: string[]) => a))(source());
    const open = () => {
      if (!o.liveSearchMs) return render(firstPage());
      // Nothing at first, then "No results found" while the first page loads.
      input.setAttribute("aria-expanded", "true");
      setTimeout(() => {
        if (input.getAttribute("aria-expanded") === "true" && !slot.innerHTML) render([]);
      }, 50);
      setTimeout(() => {
        if (input.getAttribute("aria-expanded") === "true" && !slot.querySelector("[role=gridcell]"))
          render(firstPage());
      }, 100);
    };
    input.addEventListener("click", () => {
      if (o.rerenderOnOpen) {
        // The widget reloads: a fresh input takes this one's place, open, and this one is left detached.
        const fresh = input.cloneNode() as HTMLInputElement;
        input.replaceWith(fresh);
        wireCombo(id, source, { ...o, rerenderOnOpen: false });
        fresh.focus();
        fresh.click();
        return;
      }
      if (row && !row.querySelector(".input-row__validation") && state.selected === null) {
        row.insertAdjacentHTML(
          "beforeend",
          '<p class="input-row__validation" role="alert">This field is required.</p>',
        );
      }
      if (input.getAttribute("aria-expanded") !== "true") open();
    });
    doc.getElementById(`${id}-toggle-button`)?.addEventListener("click", () => {
      if (input.getAttribute("aria-expanded") === "true") close();
      else open();
    });
    input.addEventListener("input", () => {
      // The widget searches only while its input has focus.
      if (doc.activeElement !== input) return;
      const term = input.value.toLowerCase();
      const finds = o.finds ?? ((l: string, t: string) => l.toLowerCase().includes(t));
      const found = () => source().filter((l) => finds(l, term));
      if (o.liveSearchMs) {
        render(firstPage());
        if (term === lastTerm) return;
        lastTerm = term;
        clearTimeout(timer);
        timer = setTimeout(() => render(found()), o.liveSearchMs);
        return;
      }
      clearTimeout(timer);
      if (o.searchMs) {
        render([], true);
        timer = setTimeout(() => render(found()), o.searchMs);
      } else render(found());
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (input.getAttribute("aria-expanded") === "true") close();
      else if (state.selected !== null) {
        // cx-select clears its value on Escape while closed.
        state.selected = null;
        input.value = "";
      }
    });
    input.addEventListener("focusout", () => {
      setTimeout(() => {
        if (doc.activeElement === input) return;
        if (input.value !== shown()) input.value = shown();
        close();
      }, 0);
    });
  };
  const cityOptions = { searchMs: CITY_SEARCH_MS, display: (l: string) => l.split(",")[0] ?? l };
  const cities = () => CITIES[combos.get("country-30")?.selected ?? ""] ?? [];
  wireCombo("city-33", cities, cityOptions);
  // Choosing a country reloads the city list: its first opening after that re-renders the widget.
  wireCombo("country-30", () => COUNTRIES, {
    chosen: () => {
      const old = doc.getElementById("city-33") as HTMLInputElement;
      old.replaceWith(old.cloneNode());
      wireCombo("city-33", cities, { ...cityOptions, rerenderOnOpen: true });
    },
  });
  wireCombo("postalCode-36", () => POSTAL_CODES, {
    searchMs: CITY_SEARCH_MS,
    display: (l) => l.split(",")[0] ?? l,
    finds: (l, t) => !t.includes(",") && l.toLowerCase().startsWith(t),
    firstPage: (all) => all.slice(0, 2),
    ...(opts.liveSearch ? { liveSearchMs: POSTAL_SEARCH_DELAY_MS } : {}),
  });
  wireCombo("country-codes-dropdownphoneNumber", () => ["+1 Canada", "+1 United States", "+358 Finland"]);
  wireCombo("month-300000392474837-24", () => MONTHS);
  wireCombo("day-300000392474837-24", () => DAYS);
  wireCombo("year-300000392474837-24", () => YEARS);

  // ---- the phone number is shown formatted once entered, as live ----
  const tel = $<HTMLInputElement>(".phone-row__input");
  tel.addEventListener("change", () => {
    const d = tel.value.replace(/\D/g, "");
    if (d.length === 10) tel.value = `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  });

  // ---- pills: single-select ones unselect when pressed again ----
  for (const list of doc.querySelectorAll<HTMLElement>(".cx-select-pills-container")) {
    const multi = Boolean(list.querySelector(".cx-select-pill__plus-icon"));
    const buttons = [...list.querySelectorAll<HTMLButtonElement>("button")];
    for (const b of buttons) {
      b.addEventListener("click", () => {
        const on = b.getAttribute("aria-pressed") === "true";
        if (!multi) for (const o of buttons) o.setAttribute("aria-pressed", "false");
        b.setAttribute("aria-pressed", String(!on));
        b.classList.toggle("cx-select-pill-section--selected", !on);
        const icon = b.querySelector("span:last-child");
        if (multi && icon) icon.className = !on ? "cx-select-pill__remove-icon" : "cx-select-pill__plus-icon";
      });
    }
  }

  // ---- attachments ----
  const wireUpload = (inputId: string) => {
    const button = (doc.getElementById(inputId) as HTMLElement).closest(".attachment-upload-button") as HTMLElement;
    const waiting = button.innerHTML;
    const misc = button.closest(".apply-flow-block--misc-attachments");
    const attach = (name: string) => {
      if (misc) {
        const item = doc.createElement("div");
        item.className = "misc-attachment-list__item";
        item.innerHTML = `<button class="misc-attachment-list__item-name input-row__control">${name}</button><button class="misc-attachment-list__item-remove" aria-label="${name} Remove"></button>`;
        item.querySelector(".misc-attachment-list__item-remove")?.addEventListener("click", () => item.remove());
        misc.querySelector(".misc-attachment-list")?.append(item);
        return;
      }
      button.innerHTML = `<div class="attachment-upload-button__filled">
        <button type="button" class="attachment-upload-button__download">${name}</button>
        <button type="button" class="attachment-upload-button__bottom-button">Remove</button></div>`;
      button.querySelector(".attachment-upload-button__bottom-button")?.addEventListener("click", () => {
        button.innerHTML = waiting;
        listen();
      });
    };
    const listen = () => {
      doc.getElementById(inputId)?.addEventListener("change", (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        setTimeout(() => attach(file.name), 60);
      });
    };
    listen();
    return attach;
  };
  const attachResume = wireUpload("attachment-upload-4");
  wireUpload("attachment-upload-5");
  wireUpload("attachment-upload-9");
  if (opts.resumeOnFile) attachResume(opts.resumeOnFile);

  // ---- add another link ----
  const links = $<HTMLElement>(".candidate-links");
  $<HTMLElement>(".candidate-links__add-link").addEventListener("click", () => {
    const n = links.querySelectorAll(".input-row").length + 1;
    links
      .querySelector(".candidate-links__add-link")
      ?.insertAdjacentHTML(
        "beforebegin",
        text(`siteLink-${n}-${50 + n}`, `siteLink-${n}`, `Link ${n}`, false, 'type="url"'),
      );
  });

  // ---- languages: Add Language opens an inline form; Save adds a tile ----
  const langBlock = $<HTMLElement>("#block-languages");
  const inline = langBlock.querySelector(".inline-form") as HTMLElement;
  const tiles = langBlock.querySelector(".tiles") as HTMLElement;
  langBlock.querySelector(".apply-flow-profile-item-tile__new-tile")?.addEventListener("click", () => {
    inline.innerHTML = `<div class="profile-item-content"><div class="profile-item-content--form">
        ${combo("language-60", "languageCode", "Language", true)}
        ${pills("readingLevel", "readingLevel-61", "Reading Level", ["Basic", "Fluent"], false, true)}
      </div></div>
      <div class="profile-item-footer"><div class="app-dialog__buttons-bar">
        <button class="button app-dialog__footer-button cancel-btn"><span class="button__label">Cancel</span></button>
        <button class="button app-dialog__footer-button save-btn" data-qa="profileItemInlineSaveButton"><span class="button__label">Save</span></button>
      </div></div>`;
    wireCombo("language-60", () => LANGUAGES);
    for (const b of inline.querySelectorAll<HTMLButtonElement>(".cx-select-pill-section")) {
      b.addEventListener("click", () => {
        for (const o of inline.querySelectorAll(".cx-select-pill-section")) o.setAttribute("aria-pressed", "false");
        b.setAttribute("aria-pressed", "true");
      });
    }
    inline.querySelector(".save-btn")?.addEventListener("click", () => {
      const language = combos.get("language-60")?.selected;
      const level = [...inline.querySelectorAll(".cx-select-pill-section")].find(
        (b) => b.getAttribute("aria-pressed") === "true",
      );
      if (!language || !level) {
        const rowEl = inline.querySelector(".input-row") as HTMLElement;
        if (!rowEl.querySelector(".input-row__validation")) {
          rowEl.insertAdjacentHTML(
            "beforeend",
            '<p class="input-row__validation" role="alert">This field is required.</p>',
          );
        }
        return;
      }
      tiles.insertAdjacentHTML(
        "beforeend",
        `<article class="apply-flow-profile-item-tile"><div class="apply-flow-profile-item-tile__summary" role="group">
          <div class="apply-flow-profile-item-tile__summary-content"><div class="apply-flow-profile-item-tile__summary-title"><span>${language}</span></div>
          <div class="apply-flow-profile-item-tile__summary-subtitle">${level.textContent?.trim()}</div></div>
          <div class="apply-flow-profile-item-tile__actions-container"><button class="apply-flow-profile-item-tile__delete-icon" aria-label="Delete"></button></div>
        </div></article>`,
      );
      const tile = tiles.lastElementChild as HTMLElement;
      tile.querySelector(".apply-flow-profile-item-tile__delete-icon")?.addEventListener("click", () => tile.remove());
      inline.innerHTML = "";
      $<HTMLElement>(".notifications").textContent = "Saved";
    });
  });

  // ---- timeline: the delete button shows while hovered, and the entry goes a moment after ----
  const item = $<HTMLElement>(".beautiful-timeline-item");
  item.addEventListener("mouseover", () => {
    if (item.querySelector(".beautiful-timeline-item__actions")) return;
    item.insertAdjacentHTML(
      "beforeend",
      '<div class="beautiful-timeline-item__actions"><button type="button" class="beautiful-timeline-item__edit-icon" aria-label="Change"></button><button type="button" class="beautiful-timeline-item__delete-icon" aria-label="Remove"></button></div>',
    );
    item.querySelector(".beautiful-timeline-item__delete-icon")?.addEventListener("click", () => {
      setTimeout(() => item.remove(), 200);
    });
  });

  // ---- pagination ----
  const sections = [...doc.querySelectorAll<HTMLElement>("apply-flow-section[id^='section-']")];
  const buttons = $<HTMLElement>(".apply-flow-pagination__buttons");
  let current = 0;
  const showSection = () => {
    for (const [i, s] of sections.entries()) s.hidden = Boolean(opts.multiPage) && i !== current;
    ($("h1") as HTMLElement).textContent = `Firmware Engineer application, step ${current + 1} of ${sections.length}`;
    const last = !opts.multiPage || current === sections.length - 1;
    buttons.innerHTML = `
      ${opts.multiPage && current > 0 ? '<button type="button" class="button apply-flow-pagination__button text-color-secondary" aria-label="Previous"><span class="button__label">Previous</span></button>' : ""}
      ${last ? '<button type="button" class="button apply-flow-pagination__button apply-flow-pagination__submit-button"><span class="button__label">Submit</span></button>' : '<button type="button" class="button apply-flow-pagination__button" data-qa="applyFlowPaginationNextButton"><span class="button__label">Next</span></button>'}`;
    buttons.querySelector("[data-qa='applyFlowPaginationNextButton']")?.addEventListener("click", () => {
      // Section 1 needs a last name before moving on.
      const lastName = doc.getElementById("lastName-39") as HTMLInputElement;
      const rowEl = lastName.closest(".input-row") as HTMLElement;
      if (current === 0 && !lastName.value) {
        if (!rowEl.querySelector(".input-row__validation")) {
          rowEl.insertAdjacentHTML(
            "beforeend",
            '<p class="input-row__validation" role="alert">This field is required.</p>',
          );
        }
        return;
      }
      rowEl.querySelector(".input-row__validation")?.remove();
      current++;
      showSection();
    });
    buttons.querySelector("[aria-label='Previous']")?.addEventListener("click", () => {
      current--;
      showSection();
    });
    buttons.querySelector(".apply-flow-pagination__submit-button")?.addEventListener("click", () => {
      submitClicks++;
    });
  };
  showSection();

  // ---- Welcome Back ----
  const overlay = $<HTMLElement>(".profile-selection-overlay");
  overlay.querySelector("button")?.addEventListener("click", () => {
    overlay.style.display = "none";
  });

  return {
    submitClicks: () => submitClicks,
    comboValue: (id: string) => combos.get(id)?.selected ?? null,
    w,
  };
}

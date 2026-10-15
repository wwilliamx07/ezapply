// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { antSelectDriver } from "../src/widgets/antd-select.js";
import { toggleButtonsDriver } from "../src/widgets/buttons.js";
import { comboboxDriver } from "../src/widgets/combobox.js";
import { monthPickerDriver } from "../src/widgets/datepicker.js";
import { fileDriver } from "../src/widgets/file.js";
import {
  checkboxDriver,
  checkboxGroupDriver,
  dateInputDriver,
  passwordDriver,
  radioDriver,
  selectDriver,
  textDriver,
} from "../src/widgets/native.js";
import { reactSelectDriver } from "../src/widgets/react-select.js";
import { ui5DatePickerDriver } from "../src/widgets/ui5-datepicker.js";
import { installDomShims } from "./shims.js";

installDomShims(document.defaultView as Window);

/** A field container with this markup, on the page. */
function field(html: string): HTMLElement {
  document.body.innerHTML = `<div class="field">${html}</div>`;
  return document.querySelector(".field") as HTMLElement;
}

describe("native controls", () => {
  it("text and textarea: set past a value tracker, read back, a reformatted phone accepted, read-only refused", async () => {
    const c = field('<label for="n">Name</label><input id="n" type="text">');
    expect(await textDriver("text").fill(c, "Jane")).toEqual({ ok: true, readBack: "Jane" });
    const tel = field('<input type="tel">');
    tel.querySelector("input")?.addEventListener("change", (e) => {
      (e.target as HTMLInputElement).value = "(416) 555-0100";
    });
    expect(await textDriver("text").fill(tel, "4165550100")).toMatchObject({ ok: true });
    const ro = field('<input type="text" readonly value="a@b.c">');
    expect(await textDriver("text").fill(ro, "x")).toMatchObject({ ok: false, error: /read-only/ });
    const area = field("<textarea></textarea>");
    expect(textDriver("textarea").value(area)).toBe("");
    expect(await textDriver("textarea").fill(area, "Line one\nLine two")).toMatchObject({
      ok: true,
    });
  });

  it("select: the placeholder isn't an option, a prefix picks the one option it begins, the options come back on a miss", async () => {
    const c = field(
      '<select><option value="">Select...</option><option value="1">Yes, I do</option><option value="0">No</option></select>',
    );
    const d = selectDriver();
    expect(d.options?.(c)).toEqual(["Yes, I do", "No"]);
    expect(d.value(c)).toBeNull();
    expect(await d.fill(c, "Maybe")).toMatchObject({ ok: false, availableOptions: ["Yes, I do", "No"] });
    expect(await d.fill(c, "Yes")).toEqual({ ok: true, readBack: "Yes, I do" });
    expect(await d.fill(c, "No")).toEqual({ ok: true, readBack: "No" });
    expect(d.value(c)).toBe("No");
  });

  it("radio, checkbox and checkbox group, by their own labels", async () => {
    const r = field(
      '<label><input type="radio" name="a" value="y"><span>Yes</span></label><label><input type="radio" name="a" value="n"><span>No</span></label>',
    );
    expect(radioDriver().options?.(r)).toEqual(["Yes", "No"]);
    expect(await radioDriver().fill(r, "No")).toEqual({ ok: true, readBack: "No" });
    expect(radioDriver().value(r)).toBe("No");

    const one = field('<label><input type="checkbox"><span>I agree</span></label>');
    expect(await checkboxDriver().fill(one, true)).toEqual({ ok: true, readBack: true });

    const group = field(
      ["He/him", "She/her", "They/them"]
        .map((p) => `<label><input type="checkbox" value="${p}"><span>${p}</span></label>`)
        .join(""),
    );
    const g = checkboxGroupDriver();
    expect(await g.fill(group, ["She/her", "They/them"])).toEqual({
      ok: true,
      readBack: ["She/her", "They/them"],
    });
    expect(await g.remove?.(group, ["They/them"], {} as never)).toMatchObject({ ok: true, removed: ["They/them"] });
    expect(g.value(group)).toEqual(["She/her"]);
  });

  it("choices a press doesn't change: their label by default, React's onChange, or nothing, as the site says", async () => {
    // A checkbox whose clicks are cancelled, as a page that handles them elsewhere does.
    const stuck = (html: string) => {
      const c = field(html);
      const box = c.querySelector("input") as HTMLInputElement;
      box.addEventListener("click", (e) => e.preventDefault());
      return { c, box };
    };
    const byLabel = stuck('<input type="checkbox" id="t"><label for="t">I agree</label>');
    (byLabel.c.querySelector("label") as HTMLElement).addEventListener("click", (e) => {
      e.preventDefault();
      byLabel.box.checked = true;
    });
    expect(await checkboxDriver().fill(byLabel.c, true)).toEqual({ ok: true, readBack: true });

    const byReact = stuck('<label><input type="checkbox"><span>I agree</span></label>');
    let sent: unknown;
    (byReact.box as unknown as Record<string, unknown>).__reactProps$x = {
      onChange: (e: { target: { checked: boolean } }) => {
        sent = e.target.checked;
        byReact.box.checked = e.target.checked;
      },
    };
    expect(await checkboxDriver({ fallback: "react" }).fill(byReact.c, true)).toEqual({ ok: true, readBack: true });
    expect(sent).toBe(true);

    const none = stuck('<input type="checkbox" id="n"><label for="n">I agree</label>');
    let labelPressed = false;
    (none.c.querySelector("label") as HTMLElement).addEventListener("click", () => {
      labelPressed = true;
    });
    expect(await checkboxDriver({ fallback: "none" }).fill(none.c, true)).toMatchObject({ ok: false });
    expect(labelPressed).toBe(false);

    const radios = field(
      '<input type="radio" name="r" aria-label="Yes" value="y"><input type="radio" name="r" aria-label="No" value="n">',
    );
    const named = radioDriver({ label: (i) => `${i.getAttribute("aria-label")}!` });
    expect(named.options?.(radios)).toEqual(["Yes!", "No!"]);
    expect(await named.fill(radios, "No!")).toEqual({ ok: true, readBack: "No!" });
  });

  it("date inputs take the format their type wants; passwords are never filled", async () => {
    const c = field('<input type="month">');
    expect(dateInputDriver().dateParts?.(c)).toEqual(["MM", "YYYY"]);
    expect(await dateInputDriver().fill(c, "2030-04-30")).toEqual({ ok: true, readBack: "2030-04" });
    expect(await passwordDriver.fill(field('<input type="password">'), "x")).toMatchObject({
      ok: false,
      error: /never filled/,
    });
  });
});

describe("react-select, driven through its props", () => {
  /**
   * A react-select as React leaves it: the props live on the component's fiber, reached from the input's; after a
   * choice the input's stored fiber pointer stays the old copy and its alternate holds the current props (seen live
   * on Greenhouse), so a driver reading only the stored copy sees no value.
   */
  function reactSelect(options: { label: string; value: string }[], isMulti = false) {
    const c = field('<div class="select__control"><input role="combobox" id="q"></div><div class="shown"></div>');
    const input = c.querySelector("input") as HTMLInputElement;
    const shown = c.querySelector(".shown") as HTMLElement;
    const render = (value: unknown) => {
      const props: Record<string, unknown> = {
        options,
        value,
        isMulti,
        name: "q",
        onMenuOpen: () => {},
        getOptionLabel: (o: { label: string }) => o.label,
        onChange: (v: unknown) => render(v),
      };
      const hostProps = { id: "q", role: "combobox" };
      const host = { memoizedProps: hostProps, return: { memoizedProps: props, return: null } };
      const stored = (input as unknown as Record<string, { alternate?: unknown }>).__reactFiber$x;
      if (stored) stored.alternate = host;
      else (input as unknown as Record<string, unknown>).__reactFiber$x = host;
      (input as unknown as Record<string, unknown>).__reactProps$x = hostProps;
      shown.textContent = Array.isArray(value)
        ? value.map((o) => o.label).join(", ")
        : ((value as { label?: string })?.label ?? "");
    };
    render(isMulti ? [] : null);
    return c;
  }

  it("lists its options without opening it, chooses one, and reads the current value", async () => {
    const c = reactSelect([
      { label: "Canada +1", value: "ca" },
      { label: "United States +1", value: "us" },
    ]);
    const d = reactSelectDriver();
    expect(d.is(c)).toBe(true);
    expect(await d.list?.(c)).toEqual([{ label: "Canada +1" }, { label: "United States +1" }]);
    expect(await d.fill(c, "Canada")).toEqual({ ok: true, readBack: "Canada +1" });
    expect(d.value(c)).toBe("Canada +1");
    expect(await d.fill(c, "Mexico")).toMatchObject({ ok: false, error: /No option matches/ });
  });

  it("adds to a list that takes several values, and removes from it", async () => {
    const c = reactSelect(
      ["Python", "SQL", "Go"].map((l) => ({ label: l, value: l })),
      true,
    );
    const d = reactSelectDriver();
    expect(await d.fill(c, ["Python", "Go"])).toEqual({ ok: true, readBack: ["Python", "Go"] });
    expect(await d.remove?.(c, ["Python"], {} as never)).toMatchObject({
      ok: true,
      removed: ["Python"],
      remaining: ["Go"],
    });
  });

  /**
   * A list whose options come as you type, as Greenhouse builds them. `paginate`: react-select-async-paginate's
   * school list, which loads only while the menu is open, with the menu held by the page (a key-up opens it, Escape
   * closes it). Otherwise Greenhouse's location: no `loadOptions`, the page fetches on `onInputChange` whatever the
   * menu, and confirms a choice with a request of its own.
   */
  function typeaheadSelect(catalog: string[], paginate: boolean) {
    const c = field('<div class="select__control"><input role="combobox" id="t"></div>');
    const input = c.querySelector("input") as HTMLInputElement;
    const state = { open: false, text: "", loading: false, options: [] as { label: string }[], value: null as unknown };
    const loads: string[] = [];
    const load = (term: string) => {
      loads.push(term);
      state.loading = true;
      render();
      setTimeout(() => {
        state.loading = false;
        state.options = catalog.filter((l) => l.toLowerCase().includes(term.toLowerCase())).map((label) => ({ label }));
        render();
      }, 30);
    };
    const render = () => {
      const props: Record<string, unknown> = {
        options: state.options,
        value: state.value,
        menuIsOpen: state.open,
        isLoading: state.loading,
        ...(paginate ? { loadOptions: () => {} } : {}),
        onMenuOpen: () => {},
        onMenuClose: () => {},
        onKeyUp: (e: { code: string }) => {
          state.open = e.code !== "Escape";
          render();
        },
        onInputChange: (v: string) => {
          state.text = v;
          render();
          if (v && (!paginate || state.open)) load(v);
        },
        onChange: (v: unknown) => {
          state.open = false;
          render();
          setTimeout(
            () => {
              state.value = v;
              render();
            },
            paginate ? 0 : 50,
          );
        },
      };
      input.value = state.text;
      const hostProps = { id: "t", role: "combobox" };
      const host = { memoizedProps: hostProps, return: { memoizedProps: props, return: null } };
      const stored = (input as unknown as Record<string, { alternate?: unknown }>).__reactFiber$x;
      if (stored) stored.alternate = host;
      else (input as unknown as Record<string, unknown>).__reactFiber$x = host;
      (input as unknown as Record<string, unknown>).__reactProps$x = hostProps;
    };
    render();
    return { c, state, loads };
  }
  const keyUpMenu = (p: unknown, open: boolean) =>
    (p as { onKeyUp: (e: { code: string }) => void }).onKeyUp({ code: open ? "KeyA" : "Escape" });

  it("searches a list that loads only while its menu is open: opens it, types, chooses, then closes and clears it", async () => {
    const { c, state, loads } = typeaheadSelect(["Springfield University", "Shelbyville University"], true);
    const d = reactSelectDriver({ menu: keyUpMenu });
    expect(await d.search?.(c, "Springfield")).toEqual([{ label: "Springfield University" }]);
    expect(state).toMatchObject({ open: false, text: "" });
    expect(await d.fill(c, "Shelbyville University")).toEqual({
      ok: true,
      readBack: "Shelbyville University",
    });
    expect(state).toMatchObject({ open: false, text: "" });
    expect(loads).toEqual(["Springfield", "Shelbyville University"]);
  });

  it("ends a search nothing matches when the load ends, without waiting out the maximum", async () => {
    const { c } = typeaheadSelect(["Springfield University"], true);
    const started = Date.now();
    expect(await reactSelectDriver({ menu: keyUpMenu }).search?.(c, "Nowhere")).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("searches a list with no options until you type, and waits for a choice the page confirms itself", async () => {
    const { c } = typeaheadSelect(
      ["Springfield, Illinois, United States", "Springfield, Oregon, United States"],
      false,
    );
    const d = reactSelectDriver();
    expect(await d.search?.(c, "Springfield")).toHaveLength(2);
    expect(await d.fill(c, "Springfield, Oregon, United States")).toEqual({
      ok: true,
      readBack: "Springfield, Oregon, United States",
    });
  });
});

describe("Ant Design's Select, driven through rc-select's context", () => {
  /**
   * An antd Select as React leaves it: rc-select's `SelectContext.Provider` sits above the input, its value holding
   * the options, the values chosen and `onSelect`. As on Dayforce, a label can be a React element (a flag, the
   * dialling code, the country). After a choice the input's stored fiber stays the old copy, as on react-select.
   */
  function antSelect(options: { label: unknown; value: string }[], disabled = false) {
    const c = field(
      `<div class="ant-select ant-select-single${disabled ? " ant-select-disabled" : ""}"><div class="ant-select-selector"><span class="ant-select-selection-search"><input role="combobox" readonly id="s"></span></div></div>`,
    );
    const input = c.querySelector("input") as HTMLInputElement;
    const render = (rawValues: string[]) => {
      const ctx = {
        flattenOptions: options.map((o) => ({ label: o.label, value: o.value, data: o })),
        rawValues: new Set(rawValues),
        onSelect: (v: string) => render([v]),
      };
      const hostProps = { id: "s", role: "combobox" };
      const host = { memoizedProps: hostProps, return: { memoizedProps: { value: ctx }, return: null } };
      const stored = (input as unknown as Record<string, { alternate?: unknown }>).__reactFiber$x;
      if (stored) stored.alternate = host;
      else (input as unknown as Record<string, unknown>).__reactFiber$x = host;
      (input as unknown as Record<string, unknown>).__reactProps$x = hostProps;
    };
    render([]);
    return c;
  }
  const element = (...children: unknown[]) => ({ $$typeof: "react.element", props: { children } });

  it("lists every option by its text, and chooses one (a country past its flag and dialling code)", async () => {
    const c = antSelect([
      { label: element(element("🇨🇦"), " +", 1, " ", "Canada"), value: "CA" },
      { label: element(element("🇺🇸"), " +", 1, " ", "United States"), value: "US" },
    ]);
    const d = antSelectDriver();
    expect(d.is(c)).toBe(true);
    expect(d.value(c)).toBeNull();
    expect(await d.list?.(c)).toEqual([{ label: "🇨🇦 +1 Canada" }, { label: "🇺🇸 +1 United States" }]);
    expect(await d.fill(c, "Canada")).toEqual({ ok: true, readBack: "🇨🇦 +1 Canada" });
    expect(d.value(c)).toBe("🇨🇦 +1 Canada");
    expect(await d.fill(c, "Mexico")).toMatchObject({
      ok: false,
      availableOptions: ["🇨🇦 +1 Canada", "🇺🇸 +1 United States"],
    });
  });

  it("refuses a disabled list, which waits for an earlier answer", async () => {
    const c = antSelect([{ label: "Ontario", value: "ON" }], true);
    expect(await antSelectDriver().fill(c, "Ontario")).toMatchObject({
      ok: false,
      error: /disabled/,
    });
  });
});

describe("toggle buttons, a search field, a file field", () => {
  it("toggle buttons: presses the one named", async () => {
    const c = field('<button aria-pressed="false">Yes</button><button aria-pressed="false">No</button>');
    for (const b of c.querySelectorAll("button")) {
      b.addEventListener("click", () => {
        for (const o of c.querySelectorAll("button")) o.setAttribute("aria-pressed", String(o === b));
      });
    }
    const d = toggleButtonsDriver();
    expect(d.options?.(c)).toEqual(["Yes", "No"]);
    expect(await d.fill(c, "No")).toEqual({ ok: true, readBack: "No" });
  });

  it("toggle buttons with several pressed: their own label and pressed state, filled exactly, unpressed by remove", async () => {
    const c = field(
      ["English", "French", "Spanish"]
        .map((l) => `<button class="pill"><span class="name">${l}</span><i>+</i></button>`)
        .join(""),
    );
    for (const b of c.querySelectorAll("button")) b.addEventListener("click", () => b.classList.toggle("on"));
    const d = toggleButtonsDriver({
      buttons: "button.pill",
      label: (b) => b.querySelector(".name")?.textContent ?? "",
      pressed: (b) => b.classList.contains("on"),
      multiple: true,
    });
    expect(d.kind).toBe("checkbox-group");
    expect(d.multiple?.(c)).toBe(true);
    expect(await d.fill(c, ["French", "English"])).toEqual({ ok: true, readBack: ["English", "French"] });
    expect(await d.fill(c, ["Spanish"])).toEqual({ ok: true, readBack: ["Spanish"] });
    expect(await d.remove?.(c, null, {} as never)).toMatchObject({ ok: true, removed: ["Spanish"], remaining: [] });
  });

  it("a search field: types, waits for suggestions that come on a key event, chooses one, or lists them on a miss", async () => {
    const c = field('<input class="loc"><div class="results"></div>');
    const input = c.querySelector("input") as HTMLInputElement;
    const results = c.querySelector(".results") as HTMLElement;
    // As Lever's location field: it searches on keyup, not on input.
    input.addEventListener("keyup", () => {
      setTimeout(() => {
        results.innerHTML = ["Toronto, ON, CAN", "Toronto, OH, USA"].map((p) => `<div class="r">${p}</div>`).join("");
        for (const r of results.querySelectorAll<HTMLElement>(".r")) {
          r.addEventListener("click", () => {
            input.value = r.textContent ?? "";
            results.innerHTML = "";
          });
        }
      }, 30);
    });
    const d = comboboxDriver({
      input: (x) => x.querySelector("input"),
      options: (x) => [...x.querySelectorAll<HTMLElement>(".r")],
    });
    expect(await d.fill(c, "Toronto")).toMatchObject({
      ok: false,
      unmatched: [{ value: "Toronto", suggestions: ["Toronto, ON, CAN", "Toronto, OH, USA"] }],
    });
    expect(await d.fill(c, "Toronto, ON, CAN")).toEqual({ ok: true, readBack: ["Toronto, ON, CAN"] });
  });

  it("a file field: done when the page shows the new file; removed by its own button", async () => {
    const c = field('<input type="file"><div class="names"></div>');
    const input = c.querySelector("input") as HTMLInputElement;
    const names = c.querySelector(".names") as HTMLElement;
    input.addEventListener("change", () => {
      const name = input.files?.[0]?.name ?? "";
      names.insertAdjacentHTML("beforeend", `<p class="n">${name}<button aria-label="Remove file"></button></p>`);
      names
        .querySelector("p:last-child button")
        ?.addEventListener("click", (e) => (e.target as HTMLElement).closest("p")?.remove());
    });
    const d = fileDriver({
      names: (x) => [...x.querySelectorAll<HTMLElement>(".n")].map((p) => p.textContent ?? ""),
      removeButton: (x, name) =>
        [...x.querySelectorAll<HTMLElement>(".n")].find((p) => p.textContent === name)?.querySelector("button") ?? null,
    });
    const file = new File(["%PDF"], "resume.pdf", { type: "application/pdf" });
    expect(await d.upload?.(c, file)).toEqual({ ok: true, readBack: ["resume.pdf"] });
    expect(await d.remove?.(c, null, {} as never)).toMatchObject({ ok: true, removed: ["resume.pdf"], remaining: [] });
  });

  it("a file field by its entries: a same-named file the page replaces counts; dropped where the site says", async () => {
    const c = field('<div class="zone"></div><div class="names"><p class="n">Resume.pdf</p></div>');
    const zone = c.querySelector(".zone") as HTMLElement;
    const names = c.querySelector(".names") as HTMLElement;
    // No input: the zone takes a drop, and the page replaces the file it held.
    zone.addEventListener("drop", (e) => {
      const name = (e as DragEvent).dataTransfer?.files[0]?.name ?? "";
      names.innerHTML = `<p class="n">${name}</p>`;
    });
    const shown = (x: HTMLElement) => [...x.querySelectorAll<HTMLElement>(".n")];
    const d = fileDriver({
      input: () => null,
      names: (x) => shown(x).map((p) => p.textContent ?? ""),
      entries: (x) => shown(x).map((p) => ({ name: p.textContent ?? "", el: p })),
      dropZone: (x) => x.querySelector(".zone"),
    });
    const file = new File(["%PDF"], "resume.pdf", { type: "application/pdf" });
    expect(await d.upload?.(c, file)).toEqual({ ok: true, readBack: ["resume.pdf"] });

    const held = fileDriver({ input: () => null, names: () => ["cv.pdf"] });
    expect(await held.upload?.(c, file)).toMatchObject({ ok: false, error: /already holds cv\.pdf/ });
  });

  it("a file field's removal confirmed in a dialog when it didn't take at once", async () => {
    const c = field('<p class="n">resume.pdf<button>Remove</button></p>');
    let confirmed = false;
    const d = fileDriver({
      names: (x) => [...x.querySelectorAll<HTMLElement>(".n")].map((p) => p.firstChild?.textContent ?? ""),
      removeButton: (x) => x.querySelector("button"),
      confirmRemoval: async (doc) => {
        confirmed = true;
        doc.querySelector(".n")?.remove();
      },
    });
    expect(await d.remove?.(c, ["resume.pdf"], {} as never)).toMatchObject({ ok: true, removed: ["resume.pdf"] });
    expect(confirmed).toBe(true);
  });
});

describe("a list that settles late, and a month picker", () => {
  it("settled select: waits for a list that puts the old value back first and takes the new one a moment later", async () => {
    const c = field(
      '<select><option value="">Please Select</option><option value="A">Alberta</option><option value="O">Ontario</option></select>',
    );
    const s = c.querySelector("select") as HTMLSelectElement;
    // As Phenom's React lists behave live: the change is undone at once, then applied.
    s.addEventListener("change", () => {
      const wanted = s.value;
      s.value = "";
      setTimeout(() => {
        s.value = wanted;
      }, 60);
    });
    expect(await selectDriver({ settled: true }).fill(c, "Ontario")).toEqual({
      ok: true,
      readBack: "Ontario",
    });
  });

  /**
   * react-datepicker as Phenom shows it: an input that opens a month calendar with a year list in its header. Its
   * typing is ignored; choosing a year and pressing a month sets the input, as live.
   */
  function monthPicker(years = ["2025", "2026"], disabled: number[] = []) {
    const c = field(
      '<label for="d">From</label><div class="react-datepicker-wrapper"><div class="react-datepicker__input-container"><input id="d" type="text" value=""></div></div>',
    );
    const input = c.querySelector("input") as HTMLInputElement;
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const open = () => {
      if (document.querySelector(".react-datepicker")) return;
      const cal = document.createElement("div");
      cal.className = "react-datepicker";
      const year = years.at(-1) as string;
      const cells = MONTHS.map(
        (m, i) =>
          `<div class="react-datepicker__month-text react-datepicker__month-${i}" role="option" aria-label="Choose ${m} ${year}"${disabled.includes(i) ? ' aria-disabled="true"' : ""}>${m}</div>`,
      ).join("");
      const options = years.map((y) => `<option value="${y}">${y}</option>`).join("");
      cal.innerHTML = `<div class="react-datepicker__header"><select class="range-select">${options}</select></div><div class="react-datepicker__month" role="listbox" aria-label="month  ${year}-10">${cells}</div>`;
      const list = cal.querySelector("select") as HTMLSelectElement;
      list.value = year;
      list.addEventListener("change", () => {
        cal.querySelector(".react-datepicker__month")?.setAttribute("aria-label", `month  ${list.value}-01`);
      });
      for (const [i, cell] of cal.querySelectorAll(".react-datepicker__month-text").entries()) {
        cell.addEventListener("click", () => {
          input.value = `${String(i + 1).padStart(2, "0")}/${list.value}`;
          cal.remove();
        });
      }
      document.body.append(cal);
    };
    input.addEventListener("click", open);
    input.addEventListener("input", () => {
      input.value = "";
    });
    return { c, input };
  }

  it("month picker: opens the calendar, picks the year from its list and presses the month", async () => {
    const { c, input } = monthPicker();
    const d = monthPickerDriver();
    expect(d.dateParts?.(c)).toEqual(["MM", "YYYY"]);
    expect(await d.fill(c, "2025-08")).toEqual({ ok: true, readBack: "08/2025" });
    expect(input.value).toBe("08/2025");
    expect(document.querySelector(".react-datepicker")).toBeNull();
    // Already showing it: nothing to do.
    expect(await d.fill(c, "08/2025")).toEqual({ ok: true, readBack: "08/2025" });
  });

  it("month picker: says which years can be chosen, refuses a disabled month and a date without a month", async () => {
    const d = monthPickerDriver();
    expect(await d.fill(monthPicker().c, "2019-05")).toMatchObject({
      ok: false,
      error: "Only 2025–2026 can be chosen here.",
    });
    expect(await d.fill(monthPicker(["2026"], [11]).c, "2026-12")).toMatchObject({
      ok: false,
      error: /Dec 2026 can't be chosen/,
    });
    expect(await d.fill(monthPicker().c, "2025")).toMatchObject({ ok: false, error: /YYYY-MM/ });
  });
});

describe("a UI5 Web Components date picker", () => {
  /**
   * The component as an app registers it under a scoped tag, carrying the `ui5-date-picker` attribute. Its app hears a
   * date through the `change` event the component fires, with `{ value, valid }` (SuccessFactors' calendar widget).
   */
  function picker(attrs = 'value="" format-pattern="MM/dd/yyyy"') {
    const c = field(
      `<label>Start Date</label><ui5-date-picker-xweb ui5-date-picker="" ${attrs}></ui5-date-picker-xweb>`,
    );
    const el = c.querySelector("[ui5-date-picker]") as HTMLElement;
    const heard: unknown[] = [];
    el.addEventListener("change", (e) => heard.push((e as CustomEvent).detail));
    return { c, el, heard };
  }

  it("reads the date and its parts from the component's attributes, as a saved page keeps them", () => {
    const { c } = picker('value="12/31/2024" format-pattern="MM/dd/yyyy"');
    const d = ui5DatePickerDriver();
    expect(d.is(c)).toBe(true);
    expect(d.value(c)).toBe("12/31/2024");
    expect(d.dateParts?.(c)).toEqual(["MM", "DD", "YYYY"]);
    expect(d.value(picker().c)).toBeNull();
  });

  it("sets the value in the component's own format and fires the change its app listens to", async () => {
    const { c, el, heard } = picker();
    expect(await ui5DatePickerDriver().fill(c, "2024-03-05")).toEqual({
      ok: true,
      readBack: "03/05/2024",
    });
    expect((el as unknown as { value: string }).value).toBe("03/05/2024");
    expect(heard).toEqual([{ value: "03/05/2024", valid: true }]);
    const iso = picker('value="" format-pattern="yyyy-MM-dd"');
    expect(await ui5DatePickerDriver().fill(iso.c, "03/05/2024")).toMatchObject({
      readBack: "2024-03-05",
    });
  });

  it("refuses a month without a day, a read-only picker and a pattern with month names", async () => {
    const d = ui5DatePickerDriver();
    const { c, heard } = picker();
    expect(await d.fill(c, "2024-03")).toMatchObject({ ok: false, error: /takes a day/ });
    expect(heard).toEqual([]);
    expect(await d.fill(picker('value="" readonly=""').c, "2024-03-05")).toMatchObject({
      ok: false,
      error: /read-only/,
    });
    expect(await d.fill(picker('value="" format-pattern="MMM d, y"').c, "2024-03-05")).toMatchObject({
      ok: false,
      error: /names months/,
    });
  });
});

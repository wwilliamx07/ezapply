// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { antSelectDriver } from "../src/adapters/widgets/antd-select.js";
import { toggleButtonsDriver } from "../src/adapters/widgets/buttons.js";
import { comboboxDriver } from "../src/adapters/widgets/combobox.js";
import { monthPickerDriver } from "../src/adapters/widgets/datepicker.js";
import { fileDriver } from "../src/adapters/widgets/file.js";
import {
  checkboxDriver,
  checkboxGroupDriver,
  dateInputDriver,
  passwordDriver,
  radioDriver,
  selectDriver,
  textDriver,
} from "../src/adapters/widgets/native.js";
import { reactSelectDriver } from "../src/adapters/widgets/react-select.js";
import { installDomShims } from "./workday-fixture.js";

installDomShims(document.defaultView as Window);

/** A field container with this markup, on the page. */
function field(html: string): HTMLElement {
  document.body.innerHTML = `<div class="field">${html}</div>`;
  return document.querySelector(".field") as HTMLElement;
}

describe("native controls", () => {
  it("text and textarea: set past a value tracker, read back, a reformatted phone accepted, read-only refused", async () => {
    const c = field('<label for="n">Name</label><input id="n" type="text">');
    expect(await textDriver("text").fill(c, "Jane", { strict: false })).toEqual({ ok: true, readBack: "Jane" });
    const tel = field('<input type="tel">');
    tel.querySelector("input")?.addEventListener("change", (e) => {
      (e.target as HTMLInputElement).value = "(416) 555-0100";
    });
    expect(await textDriver("text").fill(tel, "4165550100", { strict: false })).toMatchObject({ ok: true });
    const ro = field('<input type="text" readonly value="a@b.c">');
    expect(await textDriver("text").fill(ro, "x", { strict: false })).toMatchObject({ ok: false, error: /read-only/ });
    const area = field("<textarea></textarea>");
    expect(textDriver("textarea").value(area)).toBe("");
    expect(await textDriver("textarea").fill(area, "Line one\nLine two", { strict: false })).toMatchObject({
      ok: true,
    });
  });

  it("select: the placeholder isn't an option, strict refuses a prefix, the options come back on a miss", async () => {
    const c = field(
      '<select><option value="">Select...</option><option value="1">Yes, I do</option><option value="0">No</option></select>',
    );
    const d = selectDriver();
    expect(d.options?.(c)).toEqual(["Yes, I do", "No"]);
    expect(d.value(c)).toBeNull();
    expect(await d.fill(c, "Yes", { strict: true })).toMatchObject({
      ok: false,
      availableOptions: ["Yes, I do", "No"],
    });
    expect(await d.fill(c, "No", { strict: true })).toEqual({ ok: true, readBack: "No" });
    expect(d.value(c)).toBe("No");
  });

  it("radio, checkbox and checkbox group, by their own labels", async () => {
    const r = field(
      '<label><input type="radio" name="a" value="y"><span>Yes</span></label><label><input type="radio" name="a" value="n"><span>No</span></label>',
    );
    expect(radioDriver().options?.(r)).toEqual(["Yes", "No"]);
    expect(await radioDriver().fill(r, "No", { strict: true })).toEqual({ ok: true, readBack: "No" });
    expect(radioDriver().value(r)).toBe("No");

    const one = field('<label><input type="checkbox"><span>I agree</span></label>');
    expect(await checkboxDriver().fill(one, true, { strict: false })).toEqual({ ok: true, readBack: true });

    const group = field(
      ["He/him", "She/her", "They/them"]
        .map((p) => `<label><input type="checkbox" value="${p}"><span>${p}</span></label>`)
        .join(""),
    );
    const g = checkboxGroupDriver();
    expect(await g.fill(group, ["She/her", "They/them"], { strict: true })).toEqual({
      ok: true,
      readBack: ["She/her", "They/them"],
    });
    expect(await g.remove?.(group, ["They/them"], {} as never)).toMatchObject({ ok: true, removed: ["They/them"] });
    expect(g.value(group)).toEqual(["She/her"]);
  });

  it("date inputs take the format their type wants; passwords are never filled", async () => {
    const c = field('<input type="month">');
    expect(dateInputDriver().dateParts?.(c)).toEqual(["MM", "YYYY"]);
    expect(await dateInputDriver().fill(c, "2030-04-30", { strict: false })).toEqual({ ok: true, readBack: "2030-04" });
    expect(await passwordDriver.fill(field('<input type="password">'), "x", { strict: false })).toMatchObject({
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

  it("lists its options without opening it, chooses one strictly, and reads the current value", async () => {
    const c = reactSelect([
      { label: "Canada +1", value: "ca" },
      { label: "United States +1", value: "us" },
    ]);
    const d = reactSelectDriver();
    expect(d.is(c)).toBe(true);
    expect(await d.list?.(c)).toEqual([{ label: "Canada +1" }, { label: "United States +1" }]);
    expect(await d.fill(c, "Canada", { strict: true })).toEqual({ ok: true, readBack: "Canada +1" });
    expect(d.value(c)).toBe("Canada +1");
    expect(await d.fill(c, "United", { strict: true })).toMatchObject({ ok: false, error: /exactly/ });
  });

  it("adds to a list that takes several values, and removes from it", async () => {
    const c = reactSelect(
      ["Python", "SQL", "Go"].map((l) => ({ label: l, value: l })),
      true,
    );
    const d = reactSelectDriver();
    expect(await d.fill(c, ["Python", "Go"], { strict: true })).toEqual({ ok: true, readBack: ["Python", "Go"] });
    expect(await d.remove?.(c, ["Python"], {} as never)).toMatchObject({
      ok: true,
      removed: ["Python"],
      remaining: ["Go"],
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

  it("lists every option by its text, and chooses one strictly (a country past its flag and dialling code)", async () => {
    const c = antSelect([
      { label: element(element("🇨🇦"), " +", 1, " ", "Canada"), value: "CA" },
      { label: element(element("🇺🇸"), " +", 1, " ", "United States"), value: "US" },
    ]);
    const d = antSelectDriver();
    expect(d.is(c)).toBe(true);
    expect(d.value(c)).toBeNull();
    expect(await d.list?.(c)).toEqual([{ label: "🇨🇦 +1 Canada" }, { label: "🇺🇸 +1 United States" }]);
    expect(await d.fill(c, "Canada", { strict: true })).toEqual({ ok: true, readBack: "🇨🇦 +1 Canada" });
    expect(d.value(c)).toBe("🇨🇦 +1 Canada");
    expect(await d.fill(c, "Mexico", { strict: true })).toMatchObject({
      ok: false,
      availableOptions: ["🇨🇦 +1 Canada", "🇺🇸 +1 United States"],
    });
  });

  it("refuses a disabled list, which waits for an earlier answer", async () => {
    const c = antSelect([{ label: "Ontario", value: "ON" }], true);
    expect(await antSelectDriver().fill(c, "Ontario", { strict: true })).toMatchObject({
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
    expect(await d.fill(c, "No", { strict: true })).toEqual({ ok: true, readBack: "No" });
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
    expect(await d.fill(c, "Toronto", { strict: false })).toMatchObject({
      ok: false,
      unmatched: [{ value: "Toronto", suggestions: ["Toronto, ON, CAN", "Toronto, OH, USA"] }],
    });
    expect(await d.fill(c, "Toronto, ON, CAN", { strict: true })).toEqual({ ok: true, readBack: ["Toronto, ON, CAN"] });
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
    expect(await selectDriver({ settled: true }).fill(c, "Ontario", { strict: true })).toEqual({
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
    expect(await d.fill(c, "2025-08", { strict: true })).toEqual({ ok: true, readBack: "08/2025" });
    expect(input.value).toBe("08/2025");
    expect(document.querySelector(".react-datepicker")).toBeNull();
    // Already showing it: nothing to do.
    expect(await d.fill(c, "08/2025", { strict: true })).toEqual({ ok: true, readBack: "08/2025" });
  });

  it("month picker: says which years can be chosen, refuses a disabled month and a date without a month", async () => {
    const d = monthPickerDriver();
    expect(await d.fill(monthPicker().c, "2019-05", { strict: true })).toMatchObject({
      ok: false,
      error: "Only 2025–2026 can be chosen here.",
    });
    expect(await d.fill(monthPicker(["2026"], [11]).c, "2026-12", { strict: true })).toMatchObject({
      ok: false,
      error: /Dec 2026 can't be chosen/,
    });
    expect(await d.fill(monthPicker().c, "2025", { strict: true })).toMatchObject({ ok: false, error: /YYYY-MM/ });
  });
});

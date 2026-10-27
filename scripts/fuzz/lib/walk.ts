import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Browser, BrowserContext, Locator, Page } from "playwright";
import type { MapControl, MapPage, UiMap } from "./map.ts";
import type { Scenario, Section } from "./scenarios.ts";
import type { FuzzServer } from "./server.ts";

/**
 * The walk: from a scenario's first screen, every control the map lists on each screen is pressed in a fresh page
 * load (the presses that led there replayed first), and where it leads is checked against the map. Each screen is
 * checked against its page: its controls there, nothing on it the map lacks. Then a random walk presses anything on
 * screen and types odd values, for whatever throws.
 */

export interface Failure {
  kind: "error" | "dead" | "unmapped" | "missing" | "target" | "start" | "never-seen" | "screenshot" | "map";
  scenario: string;
  /** The map page it's about (its file). */
  page: string;
  /** The presses that reached it. */
  path: string;
  message: string;
}

export interface WalkOptions {
  shots: string;
  goldens: string;
  /** Write the screenshots as the new goldens. */
  update: boolean;
  /** Compare the screenshots with the goldens at all. */
  compare: boolean;
  seed: number;
  /** Presses in the random walk, per scenario. */
  steps: number;
  workers: number;
}

export interface ScenarioReport {
  scenario: string;
  screens: number;
  presses: number;
  shots: string[];
  newGoldens: string[];
  failures: Failure[];
}

/** One press on the way to a screen: a control of a map page, with its empty fields filled first when asked. */
interface Step {
  page: string;
  control: number;
  fill: boolean;
}

const VIEWPORTS: Record<Section, { width: number; height: number }> = {
  panel: { width: 380, height: 720 },
  review: { width: 1280, height: 800 },
  onboarding: { width: 1280, height: 860 },
};

/** What the random walk types, and the map walk tries on every field. */
export const ODD_VALUES = [
  "",
  "x".repeat(5000),
  "Zoë Ñandú 北京 مرحبا 🙂",
  "\\section*{Résumé} $x^2$ 100% & #1 _{a} \\\\ \\end{document}",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a template placeholder is the odd value
  "<img src=x onerror=alert(1)> ${7*7} {{7*7}}",
];
/** What a field gets when it must hold something for a button to work. */
const PLAIN_VALUE = "A note from the fuzzer.";

const INTERACTIVE =
  "button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [role=checkbox], [contenteditable=true]";

/** A map page as it's on screen: which of its conditional controls are there (their lines). */
interface Variant {
  key: string;
  page: MapPage;
  on: number[];
}

/** Distinct states walked per page, besides those showing a control no earlier one did. */
const STATES_PER_PAGE = 4;

/**
 * What the walks of a scenario have covered: per page, the conditional controls shown and the states (sets of
 * them) walked. A page is walked again in a state that shows a control not seen yet, so every control is pressed
 * in some state, or in a new state while it has had few: a press that leads on to the rest (Approve moving to the
 * next document) shows nothing new itself.
 */
class Coverage {
  private readonly lines = new Map<string, Set<number>>();
  private readonly states = new Map<string, Set<string>>();

  adds(v: Variant): boolean {
    const lines = this.lines.get(v.page.id);
    const states = this.states.get(v.page.id);
    if (!lines || !states || v.on.some((l) => !lines.has(l))) return true;
    return !states.has(v.key) && states.size < STATES_PER_PAGE;
  }

  cover(v: Variant): void {
    const lines = this.lines.get(v.page.id) ?? new Set<number>();
    for (const l of v.on) lines.add(l);
    this.lines.set(v.page.id, lines);
    this.states.set(v.page.id, (this.states.get(v.page.id) ?? new Set<string>()).add(v.key));
  }
}

export class Walker {
  private readonly map: UiMap;
  private readonly server: FuzzServer;
  private readonly contexts: Contexts;
  private readonly opts: WalkOptions;
  /** Every conditional control seen on screen (page id and line), across a section's scenarios. */
  readonly seen = new Set<string>();
  /** Every map page that was on screen, across a section's scenarios. */
  readonly reached = new Set<string>();

  constructor(map: UiMap, server: FuzzServer, browser: Browser, opts: WalkOptions) {
    this.map = map;
    this.server = server;
    this.contexts = new Contexts(browser, server.origin, opts.workers);
    this.opts = opts;
  }

  pagesOf(section: Section): MapPage[] {
    return [...this.map.pages.values()].filter((p) => p.id.startsWith(`${section}/`));
  }

  async scenario(sc: Scenario): Promise<ScenarioReport> {
    const report: ScenarioReport = {
      scenario: sc.name,
      screens: 0,
      presses: 0,
      shots: [],
      newGoldens: [],
      failures: [],
    };
    const pages = this.pagesOf(sc.section);
    const known = new Set<string>();
    const fail = (f: Omit<Failure, "scenario">) => {
      const k = `${f.kind}|${f.page}|${f.message}`;
      if (known.has(k)) return;
      known.add(k);
      report.failures.push({ ...f, scenario: sc.name });
    };
    /** What the walks of each page have shown, and what the paths queued will. */
    const explored = new Coverage();
    const queued = new Coverage();
    const queue: Step[][] = [[]];

    const start = this.map.pages.get(sc.start);
    while (queue.length) {
      const path = queue.shift() as Step[];
      const s = await Session.open(this.contexts, this.server, sc, VIEWPORTS[sc.section]);
      const edges: Step[] = [];
      try {
        await this.replay(s, path);
        if (path.length === 0 && start && !(await visible(s.page, start.marker)))
          fail({ kind: "start", page: start.file, path: "", message: `${sc.name} doesn't open on ${start.title}` });
        const screen = await this.inspect(s, pages, path, fail);
        report.screens++;
        await this.shoot(s, sc, path, report);
        for (const e of s.takeErrors())
          fail({ kind: "error", page: screen.pages[0]?.file ?? "", path: this.describe(path), message: e });
        const fresh = screen.variants.filter((v) => {
          if (!explored.adds(v)) return false;
          explored.cover(v);
          queued.cover(v);
          return true;
        });
        // Every field on a new screen takes the odd values, in this load: what typing them does stays on screen.
        for (const { page } of fresh)
          for (const c of page.controls) {
            if (!(await isField(s.page, c))) continue;
            for (const v of ODD_VALUES) {
              await s.fillValue(c, v);
              for (const e of s.takeErrors())
                fail({
                  kind: "error",
                  page: page.file,
                  path: `${this.describe(path)} › ${c.label} = ${preview(v)}`,
                  message: e,
                });
            }
            report.presses++;
          }
        for (const { page } of fresh)
          page.controls.forEach((c, i) => {
            if (screen.present.has(`${page.id}:${c.line}`)) edges.push({ page: page.id, control: i, fill: false });
          });
      } finally {
        await s.close();
      }
      // This screen's page closed first: the pages open at once are what the browser can take (`Session.slots`).
      const after: (Variant[] | null)[] = [];
      await pool(
        edges.map((step, i) => ({ step, i })),
        this.opts.workers,
        async ({ step, i }) => {
          after[i] = await this.press(sc, pages, path, step, fail);
          report.presses++;
        },
      );
      // Queued in the order of the presses, not the order they finished in: the same walk every run, so each
      // screen is reached by the same path and its screenshot keeps its name.
      edges.forEach((step, i) => {
        const fresher = (after[i] ?? []).filter((v) => queued.adds(v));
        if (fresher.length) {
          for (const v of fresher) queued.cover(v);
          queue.push([...path, step]);
        }
      });
    }
    await this.random(sc, fail, report);
    return report;
  }

  /** Every press of the path, in order, in a fresh load. */
  private async replay(s: Session, path: Step[]): Promise<void> {
    for (const step of path) await s.press(this.control(step), step.fill, this.fieldsOf(step.page));
  }

  private control(step: Step): MapControl {
    return this.map.pages.get(step.page)?.controls[step.control] as MapControl;
  }

  private fieldsOf(pageId: string): MapControl[] {
    return this.map.pages.get(pageId)?.controls ?? [];
  }

  describe(path: Step[]): string {
    return path.length ? path.map((s) => `${s.page.split("/")[1]}: ${this.control(s).label}`).join(" › ") : "(start)";
  }

  /** One control pressed after the path, and where that led checked: the screen's variants, or null. */
  private async press(
    sc: Scenario,
    pages: MapPage[],
    path: Step[],
    step: Step,
    fail: (f: Omit<Failure, "scenario">) => void,
  ): Promise<Variant[] | null> {
    const page = this.map.pages.get(step.page) as MapPage;
    const c = this.control(step);
    const where = this.describe([...path, step]);
    const s = await Session.open(this.contexts, this.server, sc, VIEWPORTS[sc.section]);
    try {
      await this.replay(s, path);
      s.takeErrors();
      const before = await s.effects();
      let outcome = await s.press(c, false, page.controls);
      if (outcome === "disabled") {
        // A button waiting for words: its screen's empty fields filled, then pressed.
        outcome = await s.press(c, true, page.controls);
        if (outcome === "pressed" || outcome === "typed") step.fill = true;
      }
      if (outcome !== "pressed" && outcome !== "typed") return null;
      const after = await s.effects();
      for (const e of s.takeErrors()) fail({ kind: "error", page: page.file, path: where, message: e });
      const did = differs(before, after);
      const t = c.target;
      if (t.kind === "page") {
        const markers = t.pages.map((id) => this.map.pages.get(id)?.marker ?? "");
        if (!(await waitVisible(s.page, markers))) {
          const now = await this.onScreen(s.page, pages);
          fail({
            kind: "target",
            page: page.file,
            path: where,
            message: `"${c.label}" should lead to ${t.pages.join(" or ")}; on screen: ${now.join(", ") || "no page the map has"}`,
          });
          return null;
        }
      } else if (t.kind === "tab" && after.popups === before.popups) {
        fail({ kind: "target", page: page.file, path: where, message: `"${c.label}" should open a new tab` });
      } else if (t.kind === "download" && after.downloads === before.downloads) {
        fail({ kind: "target", page: page.file, path: where, message: `"${c.label}" should start a download` });
      } else if (t.kind === "files" && after.choosers === before.choosers) {
        fail({ kind: "target", page: page.file, path: where, message: `"${c.label}" should open the file chooser` });
      } else if ((t.kind === "stays" || t.kind === "same") && !(await visible(s.page, page.marker))) {
        const now = await this.onScreen(s.page, pages);
        fail({
          kind: "target",
          page: page.file,
          path: where,
          message: `"${c.label}" should stay on ${page.title}; on screen: ${now.join(", ") || "no page the map has"}`,
        });
        return null;
      }
      // Typing changes a field and maybe nothing else: what it does is in the fields' odd values.
      // A press that leads to a page has done its part once the page is there, even the page it was pressed on.
      if (!did && t.kind !== "same" && t.kind !== "page" && outcome !== "typed")
        fail({ kind: "dead", page: page.file, path: where, message: `"${c.label}" did nothing: no change, no call` });
      if (s.page.isClosed()) return null;
      return (await this.variants(s.page, pages)).variants;
    } finally {
      await s.close();
    }
  }

  /** The map pages whose markers are on screen. */
  private async onScreen(page: Page, pages: MapPage[]): Promise<string[]> {
    const out: string[] = [];
    for (const p of pages) if (await visible(page, p.marker)) out.push(p.id);
    return out;
  }

  /**
   * The screen's map pages, and each one's variant: which of its conditional controls are on screen. A variant
   * not seen yet is explored, so a page reached in a new state (a comment added, a card answered) is walked again.
   */
  private async variants(page: Page, pages: MapPage[]): Promise<{ variants: Variant[]; present: Set<string> }> {
    const present = new Set<string>();
    const variants: Variant[] = [];
    for (const p of pages) {
      if (!(await visible(page, p.marker))) continue;
      this.reached.add(p.id);
      const on: number[] = [];
      for (const c of p.controls) {
        if (!(await visible(page, c.selector))) continue;
        present.add(`${p.id}:${c.line}`);
        if (c.when) on.push(c.line);
      }
      variants.push({ key: `${p.id}[${on.join(",")}]`, page: p, on });
    }
    return { variants, present };
  }

  /** Checks a screen against the map: each page's controls there unless conditional, nothing on it the map lacks. */
  private async inspect(
    s: Session,
    pages: MapPage[],
    path: Step[],
    fail: (f: Omit<Failure, "scenario">) => void,
  ): Promise<{ variants: Variant[]; present: Set<string>; pages: MapPage[] }> {
    const { variants, present } = await this.variants(s.page, pages);
    const where = this.describe(path);
    const shown = variants.map((v) => v.page);
    await s.page.evaluate(() => (window as unknown as FuzzWindow).__fuzz.mapped.clear());
    for (const p of shown)
      for (const c of p.controls) {
        if (present.has(`${p.id}:${c.line}`)) {
          if (c.when) this.seen.add(`${p.id}:${c.line}`);
          await s.page
            .locator(c.selector)
            .evaluateAll((els) => {
              for (const e of els) (window as unknown as FuzzWindow).__fuzz.mapped.add(e);
            })
            .catch(() => {});
        } else if (!c.when)
          fail({
            kind: "missing",
            page: p.file,
            path: where,
            message: `"${c.label}" (${c.selector}) isn't on ${p.title}`,
          });
      }
    const unmapped = await s.page.evaluate((sel) => {
      const fz = (window as unknown as FuzzWindow).__fuzz;
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        if (fz.mapped.has(el) || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const name =
          el.getAttribute("aria-label") ||
          (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent) ||
          el.closest("label")?.textContent ||
          el.getAttribute("placeholder") ||
          el.textContent ||
          el.getAttribute("title") ||
          "";
        const type = el instanceof HTMLInputElement ? `[type=${el.type}]` : "";
        out.push(`${el.tagName.toLowerCase()}${type} "${name.replace(/\s+/g, " ").trim().slice(0, 60)}"`);
      }
      return out;
    }, INTERACTIVE);
    for (const u of new Set(unmapped))
      fail({
        kind: "unmapped",
        page: shown[0]?.file ?? "",
        path: where,
        message: `${u} is on screen (${shown.map((p) => p.id).join(", ") || "no page the map has"}) but on no map page`,
      });
    return { variants, present, pages: shown };
  }

  private async shoot(s: Session, sc: Scenario, path: Step[], report: ScenarioReport): Promise<void> {
    const name = path.length
      ? path
          .map((st) => this.control(st).label)
          .join("--")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 120)
      : "start";
    const rel = join(sc.name, `${name}.png`);
    const png = await s.page.screenshot({ animations: "disabled", caret: "hide" });
    const shot = join(this.opts.shots, rel);
    mkdirSync(dirname(shot), { recursive: true });
    writeFileSync(shot, png);
    report.shots.push(shot);
    if (!this.opts.compare) return;
    const golden = join(this.opts.goldens, rel);
    const fresh = golden.replace(/\.png$/, ".new.png");
    if (this.opts.update || !existsSync(golden)) {
      mkdirSync(dirname(golden), { recursive: true });
      writeFileSync(golden, png);
      report.newGoldens.push(golden);
      return;
    }
    const old = readFileSync(golden);
    if (old.equals(png)) return;
    const diff = await pixelDiff(this.contexts, old, png);
    if (diff === null || diff > 0.0005) {
      writeFileSync(fresh, png);
      report.failures.push({
        kind: "screenshot",
        scenario: sc.name,
        page: "",
        path: this.describe(path),
        message: `differs from its golden ${diff === null ? "in size" : `in ${(diff * 100).toFixed(2)}% of its pixels`}: compare ${golden} with ${fresh}`,
      });
    }
  }

  /** Presses anything on screen, at random, typing odd values into fields: what throws is a failure. */
  private async random(sc: Scenario, fail: (f: Omit<Failure, "scenario">) => void, report: ScenarioReport) {
    if (this.opts.steps <= 0) return;
    const rnd = mulberry32(this.opts.seed + hash(sc.name));
    let s = await Session.open(this.contexts, this.server, sc, VIEWPORTS[sc.section]);
    let trail: string[] = [];
    try {
      for (let i = 0; i < this.opts.steps; i++) {
        if (s.page.isClosed()) {
          await s.close();
          s = await Session.open(this.contexts, this.server, sc, VIEWPORTS[sc.section]);
          trail = [];
        }
        const all = s.page.locator(INTERACTIVE);
        const n = await all.count();
        const candidates: Locator[] = [];
        for (let k = 0; k < n; k++) {
          const el = all.nth(k);
          if ((await el.isVisible().catch(() => false)) && (await isEnabled(el))) candidates.push(el);
        }
        if (!candidates.length) {
          // Nothing to press on the first screen: there's nothing to walk.
          if (!trail.length) break;
          await s.close();
          s = await Session.open(this.contexts, this.server, sc, VIEWPORTS[sc.section]);
          trail = [];
          continue;
        }
        const el = candidates[Math.floor(rnd() * candidates.length)] as Locator;
        const what = await el
          .evaluate(
            (e) =>
              `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 40)}"`,
          )
          .catch(() => "?");
        const value = ODD_VALUES[Math.floor(rnd() * ODD_VALUES.length)] as string;
        const done = await s.act(el, value).catch(() => null);
        if (!done) continue;
        trail.push(done === "typed" ? `${what} = ${preview(value)}` : what);
        report.presses++;
        for (const e of s.takeErrors())
          fail({
            kind: "error",
            page: "",
            path: `random walk (seed ${this.opts.seed}): ${trail.join(" › ")}`,
            message: e,
          });
      }
    } finally {
      await s.close();
    }
  }
}

interface FuzzWindow {
  __fuzz: { mut: number; fetching: number; fetches: number; mapped: Set<Element> };
}

interface Effects {
  mut: number;
  requests: number;
  popups: number;
  downloads: number;
  choosers: number;
  dialogs: number;
  url: string;
}

function differs(a: Effects, b: Effects): boolean {
  return (
    a.mut !== b.mut ||
    a.requests !== b.requests ||
    a.popups !== b.popups ||
    a.downloads !== b.downloads ||
    a.choosers !== b.choosers ||
    a.dialogs !== b.dialogs ||
    a.url !== b.url
  );
}

/**
 * One fresh page load of a scenario: its own fake, the page's errors collected, and what a press set off counted
 * (changes to the page, requests, tabs, downloads, dialogs), so a press that did nothing is told from one that did.
 */
class Session {
  readonly page: Page;
  private readonly closeRun: () => void;
  private errors: string[] = [];
  private closed = false;
  private inflight = 0;
  private counts = { requests: 0, popups: 0, downloads: 0, choosers: 0, dialogs: 0 };

  private constructor(page: Page, closeRun: () => void) {
    this.page = page;
    this.closeRun = closeRun;
  }

  static async open(
    contexts: Contexts,
    server: FuzzServer,
    sc: Scenario,
    viewport: { width: number; height: number },
  ): Promise<Session> {
    const context = await contexts.take();
    const run = server.open(sc.make());
    const page = await context.newPage();
    const s = new Session(page, () => {
      run.close();
      contexts.give(context);
    });
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      const fz = { mut: 0, fetching: 0, fetches: 0, mapped: new Set<Element>() };
      (window as unknown as FuzzWindow).__fuzz = fz;
      // The page's requests counted in the page, in step with it: Playwright's request events reach the fuzzer
      // later, and under load a page read as quiet between two of its requests was inspected half drawn.
      const fetch = window.fetch.bind(window);
      window.fetch = (...args) => {
        fz.fetching++;
        fz.fetches++;
        return fetch(...args).finally(() => fz.fetching--);
      };
      new MutationObserver(() => fz.mut++).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
    });
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      // A refusal the page shows (an action's 400, a review's 409) is the browser's log line, not the page failing.
      if (/Failed to load resource: the server responded with a status of 40[09]/.test(m.text())) return;
      s.errors.push(`console: ${m.text()}`);
    });
    page.on("pageerror", (e) => s.errors.push(`uncaught: ${e.message}`));
    page.on("request", (r) => {
      if (r.headers().accept?.includes("text/event-stream")) return;
      s.inflight++;
      s.counts.requests++;
      const done = () => s.inflight--;
      void r.response().then((res) => (res ? res.finished().then(done, done) : done()), done);
    });
    page.on("popup", (p) => {
      s.counts.popups++;
      void p.close().catch(() => {});
    });
    page.on("download", (d) => {
      s.counts.downloads++;
      void d.cancel().catch(() => {});
    });
    page.on("filechooser", (fc) => {
      s.counts.choosers++;
      void fc
        .setFiles({ name: "example-letter.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 example") })
        .catch(() => {});
    });
    page.on("dialog", (d) => {
      s.counts.dialogs++;
      void d.accept().catch(() => {});
    });
    await page.goto(run.url);
    await s.settle();
    return s;
  }

  takeErrors(): string[] {
    const e = this.errors;
    this.errors = [];
    return e;
  }

  async effects(): Promise<Effects> {
    // The page's changes and its requests: either is something a press did.
    const mut = this.page.isClosed()
      ? -1
      : await this.page
          .evaluate(
            () => (window as unknown as FuzzWindow).__fuzz.mut + (window as unknown as FuzzWindow).__fuzz.fetches * 1e6,
          )
          .catch(() => -1);
    return { mut, ...this.counts, url: this.page.isClosed() ? "" : this.page.url() };
  }

  /** Until no request is in flight and the page has stopped changing for a moment, at most a few seconds. */
  async settle(): Promise<void> {
    const end = Date.now() + 6000;
    let last = -2;
    let still = 0;
    while (Date.now() < end && !this.page.isClosed()) {
      await new Promise((ok) => setTimeout(ok, 40));
      const { mut, fetching } = await this.page
        .evaluate(() => {
          const fz = (window as unknown as FuzzWindow).__fuzz;
          return { mut: fz?.mut ?? 0, fetching: fz?.fetching ?? 0 };
        })
        .catch(() => ({ mut: -1, fetching: 0 }));
      if (mut === last && fetching === 0 && this.inflight === 0) {
        if (++still >= 3) return;
      } else still = 0;
      last = mut;
    }
  }

  /** Presses a control: its first match on screen, or "absent"; "disabled" when it can't be pressed yet. */
  async press(
    c: MapControl,
    fill: boolean,
    pageControls: MapControl[],
  ): Promise<"pressed" | "typed" | "absent" | "disabled"> {
    // As Playwright's own actions do: wait a moment for the control, and for it to be enabled.
    const el = await first(this.page, c.selector, 3000);
    if (!el) return "absent";
    if (fill) {
      for (const f of pageControls) {
        if (f === c) continue;
        const field = await first(this.page, f.selector);
        if (field && (await isFieldEl(field)) && !(await field.inputValue().catch(() => "x")))
          await field.fill(PLAIN_VALUE).catch(() => {});
      }
    }
    if (!(await waitEnabled(el, 1000))) return "disabled";
    let typed = false;
    try {
      if (await isFieldEl(el)) {
        await el.fill(PLAIN_VALUE, { timeout: 3000 });
        typed = true;
      } else if (await isSelect(el)) await this.pickNext(el);
      else await el.click({ clickCount: c.tripleClick ? 3 : 1, timeout: 3000 });
    } catch (err) {
      this.errors.push(`"${c.label}" couldn't be pressed: ${(err as Error).message.split("\n")[0]}`);
      return "absent";
    }
    await this.settle();
    return typed ? "typed" : "pressed";
  }

  async fillValue(c: MapControl, value: string): Promise<void> {
    const el = await first(this.page, c.selector);
    if (!el || !(await el.isEditable().catch(() => false))) return;
    await el.fill(value).catch(() => {});
    await this.settle();
  }

  /** The random walk's press: types into a field, picks another option, or clicks. */
  async act(el: Locator, value: string): Promise<"typed" | "clicked"> {
    if ((await isFieldEl(el)) && (await el.isEditable())) {
      await el.fill(value, { timeout: 2000 });
      await this.settle();
      return "typed";
    }
    if (await isSelect(el)) await this.pickNext(el);
    else await el.click({ timeout: 2000 });
    await this.settle();
    return "clicked";
  }

  private async pickNext(el: Locator): Promise<void> {
    const values = await el.evaluate((s) => [...(s as HTMLSelectElement).options].map((o) => o.value));
    const now = await el.inputValue();
    const next = values[(values.indexOf(now) + 1) % values.length] ?? now;
    await el.selectOption(next);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.page.close().catch(() => {});
    this.closeRun();
  }
}

/**
 * The browser contexts pages open in, one page in each at a time. Pages of one site in one context share a renderer
 * process, so side by side they ran one at a time and slowly enough to read as the UI being slow; a context each
 * gives each its own. As many as the machine can take at once (`--workers`), across every scenario.
 */
export class Contexts {
  private readonly browser: Browser;
  private readonly origin: string;
  private readonly idle: BrowserContext[] = [];
  private readonly waiting: ((c: BrowserContext) => void)[] = [];
  private made = 0;
  private readonly max: number;

  constructor(browser: Browser, origin: string, max: number) {
    this.browser = browser;
    this.origin = origin;
    this.max = max;
  }

  async take(): Promise<BrowserContext> {
    const ready = this.idle.pop();
    if (ready) return ready;
    if (this.made < this.max) {
      this.made++;
      const c = await this.browser.newContext({ serviceWorkers: "block", locale: "en-US", timezoneId: "UTC" });
      await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: this.origin });
      // Nothing leaves the machine: a link to a real site opens its tab, which loads nothing.
      await c.route(
        (url) => /^https?:/.test(url.href) && !url.href.startsWith(this.origin),
        (route) => route.abort("blockedbyclient"),
      );
      // A mail or phone link is no request to block: the browser hands it to the system's mail or phone app. Its
      // click is cancelled once the page's own handlers have had it.
      await c.addInitScript(() =>
        addEventListener("click", (e) => {
          const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
          if (a && /^(mailto|tel):/i.test(a.href)) e.preventDefault();
        }),
      );
      return c;
    }
    return new Promise((ok) => this.waiting.push(ok));
  }

  give(c: BrowserContext): void {
    const next = this.waiting.shift();
    if (next) next(c);
    else this.idle.push(c);
  }
}

/** The first match of a selector that's on screen. */
/** The first match of a selector that's on screen, waiting up to `waitMs` for one (a slow render under load). */
async function first(page: Page, selector: string, waitMs = 0): Promise<Locator | null> {
  const end = Date.now() + waitMs;
  for (;;) {
    if (page.isClosed()) return null;
    const all = page.locator(selector);
    const n = await all.count().catch(() => 0);
    for (let i = 0; i < n; i++)
      if (
        await all
          .nth(i)
          .isVisible()
          .catch(() => false)
      )
        return all.nth(i);
    if (Date.now() >= end) return null;
    await new Promise((ok) => setTimeout(ok, 100));
  }
}

/** Whether any match of a selector is on screen, in one round trip to the page. */
async function visible(page: Page, selector: string): Promise<boolean> {
  if (page.isClosed()) return false;
  return page
    .locator(selector)
    .evaluateAll((els) =>
      els.some((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && e.checkVisibility({ checkVisibilityCSS: true });
      }),
    )
    .catch(() => false);
}

/** Whether any of the selectors shows within a few seconds. */
async function waitVisible(page: Page, selectors: string[]): Promise<boolean> {
  const end = Date.now() + 3000;
  while (Date.now() < end && !page.isClosed()) {
    for (const s of selectors) if (await visible(page, s)) return true;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  return false;
}

async function waitEnabled(el: Locator, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!(await isEnabled(el))) {
    if (Date.now() >= end) return false;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  return true;
}

/** Enabled as the user sees it: not disabled, and not drawn disabled (a `summary` can't be, so it takes a class). */
async function isEnabled(el: Locator): Promise<boolean> {
  if (!(await el.isEnabled().catch(() => false))) return false;
  return el
    .evaluate(
      (e) =>
        e.getAttribute("aria-disabled") !== "true" &&
        !e.classList.contains("ez-disabled") &&
        getComputedStyle(e).pointerEvents !== "none",
    )
    .catch(() => false);
}

async function isFieldEl(el: Locator): Promise<boolean> {
  return el
    .evaluate(
      (e) =>
        e instanceof HTMLTextAreaElement ||
        (e instanceof HTMLInputElement &&
          !["checkbox", "radio", "button", "submit", "file", "range", "color"].includes(e.type)),
    )
    .catch(() => false);
}

async function isSelect(el: Locator): Promise<boolean> {
  return el.evaluate((e) => e instanceof HTMLSelectElement).catch(() => false);
}

async function isField(page: Page, c: MapControl): Promise<boolean> {
  const el = await first(page, c.selector);
  return el ? isFieldEl(el) : false;
}

/** The share of pixels that differ between two PNGs, or null when their sizes do; measured in the browser. */
async function pixelDiff(contexts: Contexts, a: Buffer, b: Buffer): Promise<number | null> {
  const context = await contexts.take();
  const page = await context.newPage();
  try {
    return await page.evaluate(
      async ([x, y]) => {
        const load = async (s: string) => createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
        const [ia, ib] = [await load(x), await load(y)];
        if (ia.width !== ib.width || ia.height !== ib.height) return null;
        const px = (img: ImageBitmap) => {
          const c = new OffscreenCanvas(img.width, img.height);
          const g = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
          g.drawImage(img, 0, 0);
          return g.getImageData(0, 0, img.width, img.height).data;
        };
        const [da, db] = [px(ia), px(ib)];
        let off = 0;
        for (let i = 0; i < da.length; i += 4) {
          const d = Math.max(
            Math.abs((da[i] ?? 0) - (db[i] ?? 0)),
            Math.abs((da[i + 1] ?? 0) - (db[i + 1] ?? 0)),
            Math.abs((da[i + 2] ?? 0) - (db[i + 2] ?? 0)),
          );
          if (d > 24) off++;
        }
        return off / (da.length / 4);
      },
      [a.toString("base64"), b.toString("base64")] as const,
    );
  } finally {
    await page.close();
    contexts.give(context);
  }
}

/** Runs `fn` over the items, at most `n` at a time. */
export async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

function preview(v: string): string {
  return v === "" ? "(empty)" : v.length > 30 ? `${v.slice(0, 27)}… (${v.length} chars)` : JSON.stringify(v);
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

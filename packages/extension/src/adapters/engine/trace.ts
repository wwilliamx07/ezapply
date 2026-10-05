import type { DebugRequest, FormSchema } from "@ezapply/protocol";
import { waitName, watchWaits } from "./timing.js";

/**
 * Autofill debug mode, the adapter's part: what happens inside the page during one form call, recorded only when
 * the companion asks (`debug` on the call, from `debug.autofill`). Without it every function here returns at once,
 * no hook is installed, and the adapter runs exactly as it does without debug mode.
 *
 * Recorded in one place, since every driver goes through the engine's DOM helpers (dom.ts): the queries the adapter
 * makes and how many elements each matched, every event it dispatches and on what, every wait (its name, how long it
 * was allowed and took, and what ended it), the branches the fillers take (a re-open, a React fallback, a second
 * date entry), how each value was matched against the options, and each field's start, end and outcome. Around
 * that: the page's state before and after, its DOM changes (summarised), and the page's own errors and requests
 * while the call runs. The companion writes it into the call's debug record; it never reaches the agent.
 *
 * Why queries are told apart from the page's own: the selector hooks sit on the DOM prototypes, which the page uses
 * too. A query counts while the adapter's own code is running: from the start of the call, and from the end of each
 * of its waits until the start of the next, never inside an event the adapter dispatches (where the page's handlers
 * run). The page's microtasks that run between can still be counted; they're few.
 *
 * It must not change what it measures: the records are small (element summaries, no markup but the snapshots
 * asked for, taken outside the timed part), and the lists are capped.
 */

/** The page at one moment of a debugged call. */
export interface PageState {
  url: string;
  step?: FormSchema["step"];
  visibility: string;
  focused: boolean;
}

/** One thing that happened, `t` ms after the call started. */
export interface TraceEvent {
  t: number;
  k: string;
  [key: string]: unknown;
}

/** What a debugged call brings back (in the bridge response's `debug`, never in its result). */
export interface DebugTrace {
  /** How long the call ran in the page. */
  ms: number;
  page: { before: PageState; after?: PageState };
  events: TraceEvent[];
  mutations: TraceEvent[];
  errors: TraceEvent[];
  requests: TraceEvent[];
  /** Fields whose fill, upload or removal failed, in order. */
  failedFields: string[];
  /** Entries past each list's cap: counted, not kept. */
  dropped?: Record<string, number>;
  markup?: { before?: string; after?: string; failures?: { fieldId: string; html: string }[] };
}

const CAPS = { events: 5000, mutations: 2000, errors: 200, requests: 500 } as const;
type ListName = keyof typeof CAPS;

/** Attributes whose changes show a widget opening, choosing, failing or being re-rendered. */
const WATCHED_ATTRIBUTES = ["aria-expanded", "aria-selected", "aria-invalid", "value", "disabled", "hidden"];

const now = () => globalThis.performance?.now() ?? Date.now();

class Recorder {
  readonly t0 = now();
  /** The adapter's own code is running: its queries count (see the module comment). */
  active = true;
  readonly lists: Record<ListName, TraceEvent[]> = { events: [], mutations: [], errors: [], requests: [] };
  readonly dropped: Partial<Record<ListName, number>> = {};
  readonly failedFields: string[] = [];
  readonly failureMarkup: { fieldId: string; html: string }[] = [];
  /**
   * The last popup or listbox the page removed during the current field, for its snapshot if it fails: kept as the
   * element, and serialised only then.
   */
  lastPopup: Element | undefined;
  /** Queries seen since the last other event, by selector, root and count: a polling wait's are one entry each. */
  private queries = new Map<string, TraceEvent>();
  private readonly undo: (() => void)[] = [];

  constructor(
    readonly doc: Document,
    readonly opts: DebugRequest,
    readonly before: PageState,
  ) {}

  at(): number {
    return Math.round(now() - this.t0);
  }

  push(list: ListName, ev: Omit<TraceEvent, "t">): TraceEvent {
    const e = { t: this.at(), ...ev } as TraceEvent;
    if (list === "events") this.queries.clear();
    const l = this.lists[list];
    if (l.length < CAPS[list]) l.push(e);
    else this.dropped[list] = (this.dropped[list] ?? 0) + 1;
    return e;
  }

  query(method: string, sel: string, root: unknown, n: number): void {
    const where = describe(root as Element, false);
    const key = `${method}\u0001${sel}\u0001${where}\u0001${n}`;
    const seen = this.queries.get(key);
    if (seen) {
      seen.x = ((seen.x as number | undefined) ?? 1) + 1;
      return;
    }
    const e = { t: this.at(), k: "query", sel, in: where, n } as TraceEvent;
    const l = this.lists.events;
    if (l.length < CAPS.events) l.push(e);
    else this.dropped.events = (this.dropped.events ?? 0) + 1;
    this.queries.set(key, e);
  }

  hook(): void {
    const w = this.doc.defaultView as (Window & typeof globalThis) | null;
    if (!w) return;
    this.undo.push(hookQueries(w, this), hookMutations(w, this), hookErrors(w, this), hookRequests(w, this));
    watchWaits(true);
    this.undo.push(() => watchWaits(false));
    // A call the companion gave up on never asks for its trace: take the hooks off anyway.
    const timer = w.setTimeout(() => {
      if (rec === this) stopDebug(this.before);
    }, 15 * 60_000);
    this.undo.push(() => w.clearTimeout(timer));
  }

  unhook(): void {
    for (const u of this.undo.splice(0).reverse()) {
      try {
        u();
      } catch {
        // a hook the page replaced since: leave the page's
      }
    }
  }
}

let rec: Recorder | null = null;

/** Debug mode is on for the call running now. */
export function tracing(): boolean {
  return rec !== null;
}

/** The markup the call should snapshot, as the companion asked. */
export function markupWanted(): DebugRequest {
  return rec?.opts ?? {};
}

/** Start recording a call: the hooks go on, and come off in `stopDebug`. A trace still running is dropped. */
export function startDebug(doc: Document, opts: DebugRequest, before: PageState): void {
  if (rec) stopDebug(before);
  rec = new Recorder(doc, opts, before);
  rec.hook();
}

/** Stop recording and take the trace (undefined when none was running). */
export function stopDebug(after: PageState): DebugTrace | undefined {
  const r = rec;
  if (!r) return undefined;
  rec = null;
  r.unhook();
  const dropped = Object.fromEntries(Object.entries(r.dropped).filter(([, n]) => n));
  return {
    ms: r.at(),
    page: { before: r.before, after },
    ...r.lists,
    failedFields: r.failedFields,
    ...(Object.keys(dropped).length ? { dropped } : {}),
    ...(r.failureMarkup.length ? { markup: { failures: r.failureMarkup } } : {}),
  };
}

/** Run `fn` with the adapter's queries not counted: inside an event the adapter dispatches, or its own snapshots. */
export function outside<R>(fn: () => R): R {
  if (!rec) return fn();
  const r = rec;
  const was = r.active;
  r.active = false;
  try {
    return fn();
  } finally {
    r.active = was;
  }
}

/** The adapter's code is running again (a wait ended): its queries count from here. */
export function resumed(): void {
  if (rec) rec.active = true;
}

/** The adapter is waiting: the page runs until it resumes. */
export function paused(): void {
  if (rec) rec.active = false;
}

/** An event the adapter dispatched or a change it made, on `el`: press, key, input, type, blur, react… */
export function act(k: string, el: Element | null | undefined, extra: Record<string, unknown> = {}): void {
  if (!rec) return;
  const target = describe(el);
  const last = rec.lists.events.at(-1);
  if (k === "type" && last?.k === "type" && last.el === target) {
    last.text = `${last.text as string}${extra.text as string}`;
    return;
  }
  rec.push("events", { k, el: target, ...extra });
}

/** A path a filler took that it takes only sometimes: a second attempt, a fallback. */
export function branch(name: string, extra: Record<string, unknown> = {}): void {
  rec?.push("events", { k: "branch", name, ...extra });
}

/** Anything else worth reading later: a dropdown's listboxes and the one read, its options… */
export function note(k: string, data: Record<string, unknown>): void {
  rec?.push("events", { k, ...data });
}

/** How a value was matched against the options on screen. */
export function matched(wanted: string, options: string[], strict: boolean, index: number): void {
  if (!rec) return;
  rec.push("events", {
    k: "match",
    wanted,
    of: options.length,
    ...(strict ? { strict } : {}),
    ...(index >= 0 ? { chosen: options[index] } : { options: options.slice(0, 40) }),
  });
}

/**
 * A wait starts: named by the wait its caller read from `T` (timing.ts), else by its length. Until it ends the
 * adapter isn't running, so the page's queries meanwhile don't count.
 */
export function waitStarted(kind: "waitFor" | "settle" | "sleep", maxMs: number, quietMs?: number): TraceEvent | null {
  if (!rec) return null;
  const name = waitName(maxMs);
  const quiet = quietMs === undefined ? undefined : waitName(quietMs);
  const ev = rec.push("events", {
    k: "wait",
    kind,
    name: name ?? `${maxMs}ms`,
    max: maxMs,
    ...(quietMs === undefined ? {} : { quiet: quiet ?? `${quietMs}ms`, quietMs }),
  });
  rec.active = false;
  return ev;
}

/** It ended: by its condition, by the page going quiet, or at its maximum (`max`). */
export function waitEnded(ev: TraceEvent | null, end: "condition" | "quiet" | "max" | "slept"): void {
  if (!ev || !rec) return;
  ev.ms = rec.at() - ev.t;
  ev.end = end;
  rec.active = true;
}

/** A field's operation starts (fill, upload, remove, list, search). */
export function fieldStarted(op: string, fieldId: string): TraceEvent | null {
  if (!rec) return null;
  rec.lastPopup = undefined;
  return rec.push("events", { k: "field", op, fieldId });
}

/** …and ends: its time and outcome go on its start event. */
export function fieldEnded(ev: TraceEvent | null, ok: boolean, error?: string): void {
  if (!ev || !rec) return;
  ev.ms = rec.at() - ev.t;
  ev.ok = ok;
  if (error) ev.error = error.slice(0, 300);
  if (!ok) rec.failedFields.push(ev.fieldId as string);
  rec.push("events", { k: "field-end", fieldId: ev.fieldId, ok });
}

/** A failed field's markup, taken while what failed may still be on screen. */
export function addFailureMarkup(fieldId: string, html: string): void {
  rec?.failureMarkup.push({ fieldId, html });
}

/** The popup or listbox the page took away last during this field (kept when failures are snapshotted). */
export function lastPopup(): Element | undefined {
  return rec?.lastPopup;
}

/**
 * A short, recognisable summary of an element: tag, automation id or id, role, and with `withText` its label or
 * text. From attributes and `textContent` only: `innerText` would make the page lay out.
 */
export function describe(el: Element | Document | null | undefined, withText = true): string {
  if (!el) return "none";
  if (el.nodeType === 9) return "document";
  if (el.nodeType === 11) return "fragment";
  const e = el as Element;
  if (typeof e.getAttribute !== "function") return String(e.nodeName ?? "node").toLowerCase();
  let s = e.tagName.toLowerCase();
  const aid = e.getAttribute("data-automation-id");
  if (aid) s += `[${aid}]`;
  else if (e.id) s += `#${e.id}`;
  const role = e.getAttribute("role");
  if (role) s += `(${role})`;
  if (withText) {
    const label = (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim();
    if (label) s += ` "${label.slice(0, 40)}"`;
  }
  return s;
}

// ---- hooks -------------------------------------------------------------------------------------------

type Proto = Record<string, unknown>;

/** Count the adapter's `querySelector`, `querySelectorAll` and `getElementById` calls and what they found. */
function hookQueries(w: Window & typeof globalThis, r: Recorder): () => void {
  const restore: (() => void)[] = [];
  const patch = (proto: Proto | undefined, name: string, count: (res: unknown) => number, sel = (a: string) => a) => {
    if (!proto || !Object.hasOwn(proto, name)) return;
    const orig = proto[name] as (this: unknown, a: string) => unknown;
    const wrapped = function (this: unknown, a: string) {
      const res = orig.call(this, a);
      if (r.active && rec === r) r.query(name, sel(a), this, count(res));
      return res;
    };
    proto[name] = wrapped;
    restore.push(() => {
      if (proto[name] === wrapped) proto[name] = orig;
    });
  };
  const one = (res: unknown) => (res ? 1 : 0);
  const all = (res: unknown) => (res as { length: number }).length;
  for (const proto of [w.Document?.prototype, w.Element?.prototype, w.DocumentFragment?.prototype]) {
    patch(proto as unknown as Proto, "querySelector", one);
    patch(proto as unknown as Proto, "querySelectorAll", all);
  }
  for (const proto of [w.Document?.prototype, w.DocumentFragment?.prototype]) {
    patch(proto as unknown as Proto, "getElementById", one, (id) => `#${id}`);
  }
  return () => {
    for (const f of restore) f();
  };
}

/** Selectors of what opens over the page: lists, menus, dialogs, Workday's popups. */
export const POPUPS =
  "[role='listbox'], [role='menu'], [role='dialog'], [role='alertdialog'], [data-automation-widget='wd-popup']";

/**
 * Summarise the page's DOM changes during the call: elements added and removed (only the topmost of each change,
 * with how many elements it held), and changes to the attributes that show a widget's state. A run of the same
 * change is one entry with a count.
 */
function hookMutations(w: Window & typeof globalThis, r: Recorder): () => void {
  const root = r.doc.body ?? r.doc.documentElement;
  if (!root || typeof w.MutationObserver !== "function") return () => {};
  const add = (ev: Omit<TraceEvent, "t">) => {
    const last = r.lists.mutations.at(-1);
    if (last && last.k === ev.k && last.el === ev.el && last.a === ev.a) {
      last.x = ((last.x as number | undefined) ?? 1) + 1;
      if ("to" in ev) last.to = ev.to;
      return;
    }
    r.push("mutations", ev);
  };
  const obs = new w.MutationObserver((records) =>
    outside(() => {
      if (rec !== r) return;
      for (const m of records) {
        if (m.type === "attributes") {
          const target = m.target as Element;
          const a = m.attributeName ?? "";
          add({ k: "attr", el: describe(target, false), a, from: m.oldValue, to: target.getAttribute(a) });
          continue;
        }
        for (const [k, nodes] of [
          ["+", m.addedNodes],
          ["-", m.removedNodes],
        ] as const) {
          for (const node of nodes) {
            if (node.nodeType !== 1) continue;
            const el = node as Element;
            add({ k, el: describe(el, false), n: el.getElementsByTagName("*").length + 1 });
            if (k === "-" && r.opts.failures) {
              const popup = el.matches(POPUPS) ? el : el.querySelector(POPUPS);
              if (popup) r.lastPopup = popup;
            }
          }
        }
      }
    }),
  );
  obs.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: WATCHED_ATTRIBUTES,
    attributeOldValue: true,
  });
  return () => obs.disconnect();
}

/** The page's own errors: uncaught, unhandled rejections, and what it logs with `console.error`. */
function hookErrors(w: Window & typeof globalThis, r: Recorder): () => void {
  const short = (x: unknown) => String((x as Error)?.message ?? x).slice(0, 300);
  const onError = (e: ErrorEvent) => {
    r.push("errors", {
      k: "error",
      message: short(e.message),
      ...(e.filename ? { at: `${e.filename}:${e.lineno}` } : {}),
    });
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    r.push("errors", { k: "rejection", message: short(e.reason) });
  };
  w.addEventListener("error", onError);
  w.addEventListener("unhandledrejection", onRejection);
  const console = w.console;
  const orig = console?.error as ((...a: unknown[]) => void) | undefined;
  const wrapped = function (this: unknown, ...args: unknown[]) {
    if (rec === r) r.push("errors", { k: "console", message: args.map(short).join(" ").slice(0, 300) });
    return orig?.apply(this, args);
  };
  if (orig) console.error = wrapped;
  return () => {
    w.removeEventListener("error", onError);
    w.removeEventListener("unhandledrejection", onRejection);
    if (orig && console.error === wrapped) console.error = orig;
  };
}

/** Where a request went: origin and path, never its query or body. */
function pathOf(w: Window, url: string): string {
  try {
    const u = new URL(url, w.location.href);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "?";
  }
}

/** The page's `fetch` and XHR requests during the call: method, where, status, how long. Never bodies. */
function hookRequests(w: Window & typeof globalThis, r: Recorder): () => void {
  const restore: (() => void)[] = [];
  const started = (method: string, url: string) =>
    r.push("requests", { k: "request", method: method.toUpperCase(), path: pathOf(w, url) });
  const ended = (ev: TraceEvent, status: number | string) => {
    ev.ms = r.at() - ev.t;
    ev.status = status;
  };

  const fetch = w.fetch;
  if (typeof fetch === "function") {
    const wrapped = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      if (rec !== r) return fetch.call(this, input, init);
      const req = input as Request;
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : req.url;
      const ev = started(init?.method ?? req.method ?? "GET", url);
      return fetch.call(this, input, init).then(
        (res) => {
          ended(ev, res.status);
          return res;
        },
        (err: unknown) => {
          ended(ev, `failed: ${String((err as Error)?.message ?? err).slice(0, 100)}`);
          throw err;
        },
      );
    } as typeof fetch;
    w.fetch = wrapped;
    restore.push(() => {
      if (w.fetch === wrapped) w.fetch = fetch;
    });
  }

  const proto = w.XMLHttpRequest?.prototype;
  if (proto) {
    const open = proto.open;
    const send = proto.send;
    const opened = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
    const wrappedOpen = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      opened.set(this, { method, url: String(url) });
      return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
    };
    const wrappedSend = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      const info = opened.get(this);
      if (info && rec === r) {
        const ev = started(info.method, info.url);
        this.addEventListener("loadend", () => ended(ev, this.status || "failed"), { once: true });
      }
      return send.call(this, body);
    };
    proto.open = wrappedOpen as typeof proto.open;
    proto.send = wrappedSend;
    restore.push(() => {
      if (proto.open === (wrappedOpen as unknown)) proto.open = open;
      if (proto.send === wrappedSend) proto.send = send;
    });
  }
  return () => {
    for (const f of restore) f();
  };
}

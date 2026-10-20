import { ext } from "../ext.js";

/** The watched tabs, by tab id: in session storage, so a background restart keeps them and a browser restart doesn't. */
const WATCHES = "submitWatches";
/** Submissions seen while the companion wasn't connected: in local storage, sent on the next connection. */
const PENDING = "pendingSubmits";
/** How often a watched tab is looked at while the background runs (a single-page site doesn't navigate). */
const POLL_MS = 3_000;
/** A watch nobody submitted on is dropped after this. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface Watch {
  postingId: string;
  /** The application's host: only a confirmation there counts. */
  host: string;
  since: number;
}

export interface SubmitReport {
  postingId: string;
  url: string;
  at: string;
}

export interface SubmitWatchDeps {
  /** The URL of an application in the tab on its confirmation page on `host`, if there is one. */
  confirmationIn(tabId: number, host: string): Promise<string | undefined>;
  /** Tell the companion; throws when it can't be reached. */
  report(r: SubmitReport): Promise<void>;
  now?: () => number;
}

/**
 * Watching for the user's Submit (`tab.watchSubmit`): after the hand-off nothing calls the form tools, so nothing
 * else would see the confirmation page. The companion asks at the review page; each watched tab is looked at every
 * few seconds while the background runs, when it finishes loading, and on the reconnect alarm (a background woken
 * from sleep has no timer running). A confirmation is reported once and the watch ends; so does closing the tab.
 */
export class SubmitWatch {
  private timer: ReturnType<typeof setInterval> | undefined;
  private checking: Promise<void> | undefined;
  private readonly now: () => number;

  constructor(private readonly deps: SubmitWatchDeps) {
    this.now = deps.now ?? Date.now;
  }

  async watch(tabId: number, url: string, postingId: string): Promise<void> {
    const watches = await this.watches();
    watches[tabId] = { postingId, host: new URL(url).host, since: this.now() };
    await this.save(watches);
  }

  async forget(tabId: number): Promise<void> {
    const watches = await this.watches();
    if (!(tabId in watches)) return;
    delete watches[tabId];
    await this.save(watches);
  }

  /** Look at every watched tab once; a check already running is joined. */
  check(): Promise<void> {
    this.checking ??= this.checkAll().finally(() => {
      this.checking = undefined;
    });
    return this.checking;
  }

  /** Look at one tab, when it's watched (it finished loading). */
  async checkTab(tabId: number): Promise<void> {
    if (tabId in (await this.watches())) await this.check();
  }

  /** Send the submissions seen while the companion was away. */
  async flush(): Promise<void> {
    const { [PENDING]: stored } = await ext.storage.local.get(PENDING);
    const pending = (stored as SubmitReport[] | undefined) ?? [];
    if (!pending.length) return;
    const left: SubmitReport[] = [];
    for (const r of pending) await this.deps.report(r).catch(() => left.push(r));
    if (left.length) await ext.storage.local.set({ [PENDING]: left });
    else await ext.storage.local.remove(PENDING);
  }

  private async checkAll(): Promise<void> {
    const ended: [number, Watch][] = [];
    for (const [id, w] of Object.entries(await this.watches())) {
      const tabId = Number(id);
      if (this.now() - w.since > MAX_AGE_MS) {
        ended.push([tabId, w]);
        continue;
      }
      const url = await this.deps.confirmationIn(tabId, w.host).catch(() => undefined);
      if (!url) continue;
      const report = { postingId: w.postingId, url, at: new Date(this.now()).toISOString() };
      await this.deps.report(report).catch(() => this.keep(report));
      ended.push([tabId, w]);
    }
    if (!ended.length) return;
    // Read again: a watch asked for meanwhile stays.
    const watches = await this.watches();
    for (const [tabId, w] of ended) if (watches[tabId]?.since === w.since) delete watches[tabId];
    await this.save(watches);
  }

  private async keep(r: SubmitReport): Promise<void> {
    const { [PENDING]: stored } = await ext.storage.local.get(PENDING);
    await ext.storage.local.set({ [PENDING]: [...((stored as SubmitReport[] | undefined) ?? []), r] });
  }

  private async watches(): Promise<Record<number, Watch>> {
    const { [WATCHES]: stored } = await ext.storage.session.get(WATCHES);
    return { ...((stored as Record<number, Watch> | undefined) ?? {}) };
  }

  /** Store the watches, and poll only while there are any. */
  private async save(watches: Record<number, Watch>): Promise<void> {
    await ext.storage.session.set({ [WATCHES]: watches });
    this.poll(Object.keys(watches).length > 0);
  }

  /** Start or stop the poll; on a background start, after reading what's watched. */
  async resume(): Promise<void> {
    this.poll(Object.keys(await this.watches()).length > 0);
  }

  private poll(on: boolean): void {
    if (on && !this.timer) this.timer = setInterval(() => void this.check(), POLL_MS);
    if (!on && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}

import { readFile, rm } from "node:fs/promises";
import {
  type AskAnswers,
  type DocumentState,
  ErrorCode,
  EzError,
  GENERAL_CONVERSATION,
  type PanelConversation,
  type PanelPosting,
  type PanelState,
  type PanelTab,
  type PanelUpdate,
  type PostingMeta,
  postingConversation,
  type SiteId,
} from "@ezapply/protocol";
import { isFormSite, siteInfo } from "@ezapply/sites";
import { matchPosting, postingFacts } from "../forms/match.js";
import type { Services } from "../services.js";
import { workspaceStatus } from "../status.js";

/** How long the setup check (`workspace_check`) is reused: it runs TeX and GitHub checks. */
const SETUP_TTL_MS = 30_000;
const RECENT_POSTINGS = 20;

/**
 * The side panel's view of the companion: its state, a conversation with its posting and documents, what the
 * current tab is, and its actions; and the updates pushed to it (an agent event, or "read your state again").
 * The panel reaches it only through the paired extension (bridge methods `panel.*`), so it needs no token of its
 * own, and a web page can't reach it.
 */
export class PanelService {
  private setupCache: { at: number; value: PanelState["setup"] } | null = null;
  private stopWatching: (() => void) | null = null;
  private changeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly s: () => Services,
    /** Push to the extension, which relays to its open panels; errors (not connected) are dropped. */
    private readonly push: (update: PanelUpdate) => Promise<unknown>,
  ) {}

  /** Start relaying: agent events as they come, and a "changed" for whatever changes the panel's state. */
  start(): void {
    const s = this.s();
    s.agent.onEvent((conversation, event) => this.pushUpdate({ event: { conversation, event } }));
    s.agent.onState(() => this.changed());
    s.needs.onChange(() => {
      // The badge counts cards even while no panel is open.
      void this.push({ cards: s.needs.list().length }).catch(() => undefined);
      this.changed();
    });
    s.postings.onActiveChange(() => this.changed());
    s.reviews.onChange(() => this.changed());
  }

  /** The number of open panels: cards are shown, and updates pushed, while it's more than none. */
  watch(open: number): void {
    if (open > 0 && !this.stopWatching) this.stopWatching = this.s().needs.watch();
    if (open === 0 && this.stopWatching) {
      this.stopWatching();
      this.stopWatching = null;
    }
  }

  get watched(): boolean {
    return this.stopWatching !== null;
  }

  async state(): Promise<PanelState> {
    const s = this.s();
    const [active, all, setup] = await Promise.all([s.postings.activeId(), s.postings.list(), this.setup()]);
    return {
      agent: { ...s.agent.state(), settings: await s.agent.settings() },
      activePostingId: active,
      postings: all.slice(0, RECENT_POSTINGS).map((m) => panelPosting(m, active)),
      cards: s.needs.list(),
      setup,
    };
  }

  async conversation(key: string): Promise<PanelConversation> {
    const s = this.s();
    const [events, totalCostUsd] = await Promise.all([s.agent.history(key), s.agent.cost(key)]);
    if (key === GENERAL_CONVERSATION) {
      return { key, documents: [], events, ...(totalCostUsd !== undefined ? { totalCostUsd } : {}) };
    }
    const id = postingOf(key);
    const meta = await s.postings.get(id);
    const active = await s.postings.activeId();
    const [requirements, application, documents, review] = await Promise.all([
      this.requirements(id),
      s.postings.application(id).catch(() => undefined),
      this.documents(id),
      s.reviews.openFor(id),
    ]);
    return {
      key,
      posting: {
        ...panelPosting(meta, active),
        requirements,
        ...(application?.url ? { application: application.url } : {}),
      },
      documents,
      ...(review ? { review } : {}),
      events,
      ...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
    };
  }

  /** What the tab is to the active posting: its application, another posting's, the posting's own page, or none. */
  async tab(t: { tabId: number; url: string; title: string; site: SiteId }): Promise<PanelTab> {
    const s = this.s();
    if (!/^https?:/i.test(t.url)) return { kind: "none", text: "Not a web page" };
    const activeId = await s.postings.activeId();
    const active = activeId ? await s.postings.get(activeId).catch(() => null) : null;
    const label = active ? [active.company, active.role].filter(Boolean).join(": ") || active.id : "";
    if (active && sameAddress(t.url, active.url)) return { kind: "posting", text: `${label}: the posting` };
    if (!isFormSite(t.site))
      return { kind: "page", text: active ? "Not this posting's application" : "No posting set" };
    const site = siteName(t.site);
    if (!active) return { kind: "unconfirmed-application", text: `An application on ${site}; no posting set` };
    const application = await s.postings.application(active.id).catch(() => undefined);
    const m = matchPosting(postingFacts(active, application), { url: t.url, site: t.site, title: t.title });
    if (m.verdict === "same") return { kind: "application", text: `${label}: the application on ${site}` };
    if (m.verdict === "other") return { kind: "other-application", text: `Another posting's application on ${site}` };
    return { kind: "unconfirmed-application", text: `An application on ${site}, maybe this posting's` };
  }

  /** The user's message to a conversation; a posting's conversation makes its posting the active one first. */
  async send(key: string, text: string): Promise<{ id: string }> {
    const s = this.s();
    if (key !== GENERAL_CONVERSATION) {
      const id = postingOf(key);
      await s.postings.get(id);
      if ((await s.postings.activeId()) !== id) await s.postings.activate(id);
    }
    return s.agent.send(key, text);
  }

  answer(cardId: string, answers: AskAnswers): void {
    this.s().needs.answer(cardId, answers);
  }

  reply(cardId: string, message: string): void {
    this.s().needs.reply(cardId, message);
  }

  permission(cardId: string, allow: boolean, reason?: string): void {
    this.s().needs.decide(cardId, allow, reason);
  }

  async open(
    what: { what: "review"; reviewId: string } | { what: "file"; postingId: string; file: string } | { what: "setup" },
  ): Promise<void> {
    const s = this.s();
    if (what.what === "setup") {
      await s.opener.url(s.onboarding.open().url);
      return;
    }
    if (what.what === "review") {
      const url = s.reviews.urlOf(what.reviewId);
      if (!url) throw new EzError(ErrorCode.NotFound, "That review is over.");
      await s.opener.url(url);
      return;
    }
    const abs = s.workspace.resolveAllowed(`postings/${what.postingId}/${what.file}`, [`postings/${what.postingId}`]);
    await s.opener.file(abs);
  }

  /** Delete a posting for good: its folder, and its conversations with the agent. */
  async deletePosting(postingId: string): Promise<void> {
    const s = this.s();
    await s.postings.get(postingId);
    if (s.reviews.openFor(postingId)) {
      throw new EzError(ErrorCode.BadRequest, "This posting has a review open. Finish or close it first.");
    }
    await s.agent.forgetPosting(postingId);
    await s.postings.delete(postingId);
    this.changed();
  }

  /**
   * Delete one of a posting's documents (a PDF the panel lists) for good. Its LaTeX source, if it has one, stays, so
   * Claude can build it again.
   */
  async deleteDocument(postingId: string, file: string): Promise<void> {
    const s = this.s();
    const listed = await this.documents(postingId);
    const doc = listed.find((d) => d.file === file);
    if (!doc) throw new EzError(ErrorCode.NotFound, `No document ${file} in this posting.`);
    if (doc.state === "review") {
      throw new EzError(ErrorCode.BadRequest, `${file} is in an open review. Finish or close it first.`);
    }
    await rm(s.workspace.resolveAllowed(`postings/${postingId}/${file}`, [`postings/${postingId}`]), { force: true });
    this.changed();
  }

  // ---- internals ----

  private pushUpdate(update: PanelUpdate): void {
    if (!this.watched) return;
    void this.push(update).catch(() => undefined);
  }

  /** Coalesced: a burst of changes (a card and the agent's state) is one "read your state again". */
  private changed(): void {
    this.setupCache = null;
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => this.pushUpdate({ changed: true }), 50);
    this.changeTimer.unref?.();
  }

  private async setup(): Promise<PanelState["setup"]> {
    if (this.setupCache && Date.now() - this.setupCache.at < SETUP_TTL_MS) return this.setupCache.value;
    const status = await workspaceStatus(this.s()).catch(() => null);
    const value = status
      ? { ready: status.ready, left: status.items.filter((i) => i.required && !i.done).map((i) => i.step) }
      : { ready: false, left: [] };
    this.setupCache = { at: Date.now(), value };
    return value;
  }

  /** The bullet lines under `## Application requirements` in the posting's notes.md, short. */
  private async requirements(key: string): Promise<string[]> {
    const text = await readFile(this.s().workspace.path("postings", key, "notes.md"), "utf8").catch(() => "");
    const m = text.match(/^##\s+Application requirements\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
    if (!m) return [];
    return (m[1] ?? "")
      .split("\n")
      .map((l) =>
        l
          .match(/^\s*[-*]\s+(.*)$/)?.[1]
          ?.replace(/\*\*/g, "")
          .trim(),
      )
      .filter((l): l is string => Boolean(l))
      .slice(0, 6)
      .map((l) => (l.length > 70 ? `${l.slice(0, 69)}…` : l));
  }

  /** The posting's PDFs and where each stands: draft, in a review, approved, changes asked, attached. */
  private async documents(key: string): Promise<{ file: string; state: DocumentState }[]> {
    const s = this.s();
    const details = await s.postings.details(key);
    const pdfs = details.files.map((f) => f.path).filter((p) => p.toLowerCase().endsWith(".pdf") && !p.includes("/"));
    const states = await s.reviews.documentStates(key, pdfs);
    const attached = await this.attached(key);
    return pdfs.map((file) => ({
      file,
      state: attached.has(file) && states[file] === "approved" ? "attached" : (states[file] ?? "draft"),
    }));
  }

  /** Files the form log shows uploaded to the application. */
  private async attached(key: string): Promise<Set<string>> {
    const text = await readFile(this.s().workspace.path("postings", key, "form-log.jsonl"), "utf8").catch(() => "");
    const out = new Set<string>();
    for (const line of text.split("\n")) {
      try {
        const e = JSON.parse(line) as { event?: string; ok?: boolean; file?: string };
        if (e.event === "upload" && e.ok && typeof e.file === "string") out.add(e.file.split(/[\\/]/).pop() as string);
      } catch {
        // not a line
      }
    }
    return out;
  }
}

/** The posting a posting conversation's key names. */
function postingOf(key: string): string {
  const c = postingConversation(key);
  if (!c) throw new EzError(ErrorCode.BadRequest, `Not a conversation: ${key}`);
  return c.postingId;
}

function panelPosting(m: PostingMeta, activeId: string | null): PanelPosting {
  return {
    id: m.id,
    ...(m.company ? { company: m.company } : {}),
    ...(m.role ? { role: m.role } : {}),
    site: m.site,
    status: m.status,
    ...(m.deadline ? { deadline: m.deadline } : {}),
    url: m.url,
    active: m.id === activeId,
  };
}

function sameAddress(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.host === y.host && x.pathname.replace(/\/$/, "") === y.pathname.replace(/\/$/, "");
  } catch {
    return false;
  }
}

function siteName(site: SiteId): string {
  return siteInfo(site)?.name ?? site;
}

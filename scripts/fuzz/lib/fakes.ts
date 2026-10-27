import {
  type AgentEvent,
  type AgentPrefs,
  effectiveSettings,
  GENERAL_CONVERSATION,
  type OnboardRepo,
  type OnboardState,
  type PanelConversation,
  type PanelState,
  type PanelTab,
  postingConversation,
  type ReviewAnswerBody,
  type ReviewPageState,
  type WorkspaceChangeOutcome,
  type WorkspaceChangeRequest,
  type WorkspaceChanges,
} from "@ezapply/protocol";

/**
 * The companion as each page sees it, answering from a scenario's state instead of a workspace and an agent. Each
 * fuzz run gets its own copy, so a press in one run never shows in another. Every answer is canned: the agent's
 * reply to a message, a build's outcome, a task's progress. What a press changes (a card answered, a posting
 * deleted) changes the state, and the page hears of it as it would from the companion.
 */

interface FakeRequest {
  method: string;
  /** Under the page's base: "state", "file/0", "panel/call". */
  path: string;
  query: URLSearchParams;
  body: Buffer;
  /** The fake server's origin, for addresses the page is sent to. */
  origin: string;
}

interface Reply {
  status: number;
  json?: unknown;
  body?: Buffer;
  type?: string;
  headers?: Record<string, string>;
}

type Listener = (event: string, data: unknown) => void;

export abstract class Fake {
  abstract readonly page: "panel" | "review" | "onboard";
  /** What the page asked of the companion, in order ("panel.send", "POST action pair"). */
  readonly calls: string[] = [];
  private readonly listeners = new Set<Listener>();

  abstract handle(req: FakeRequest): Reply | null;

  listen(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  protected emit(event: string, data: unknown): void {
    for (const fn of this.listeners) fn(event, data);
  }
}

const ok = (json: unknown = {}): Reply => ({ status: 200, json });
const refused = (error: string, hint?: string): Reply => ({ status: 400, json: { error, ...(hint ? { hint } : {}) } });
const AT = "2026-01-05T10:00:00.000Z";

// ---- the side panel ----------------------------------------------------------------------------------------------

type Connection =
  | { state: "connected" }
  | { state: "connecting" }
  | { state: "unconfigured" }
  | { state: "disconnected"; reason?: string }
  | { state: "error"; message: string; hint?: string };

interface PanelSetup {
  state: PanelState;
  /** Conversations by key; one not listed is a posting's empty one (or the general one's). */
  conversations?: Record<string, PanelConversation>;
  connection?: Connection;
  tab?: (PanelTab & { tabId: number }) | null;
  prefs?: AgentPrefs;
  /** What's out of date, for every conversation alike. */
  changes?: WorkspaceChanges;
  /** What Capture gives: by default the first posting, captured again. */
  capture?: { ok: true; postingId: string; label: string } | { ok: false; error: string };
}

/**
 * The panel's companion and its extension side: the `panel.*` methods, and what the transport asks the background
 * (capture, the tab, the settings). The agent answers a message at once with a canned reply, so the conversation
 * after a press is the same every run.
 */
export class PanelFake extends Fake {
  readonly page = "panel";
  private readonly s: Required<Omit<PanelSetup, "tab" | "capture">> & Pick<PanelSetup, "tab" | "capture">;
  private turn = 0;

  constructor(setup: PanelSetup) {
    super();
    this.s = structuredClone({
      conversations: {},
      connection: { state: "connected" },
      prefs: { agent: "claude", choices: {} },
      changes: { changes: [] },
      ...setup,
    });
  }

  handle(req: FakeRequest): Reply | null {
    if (req.method !== "POST") return null;
    const { method, params } = JSON.parse(req.body.toString() || "{}") as { method: string; params: unknown };
    this.calls.push(method);
    try {
      const result =
        req.path === "panel/call" ? this.call(method, params as Record<string, unknown>) : this.side(method, params);
      return ok({ result });
    } catch (err) {
      return ok({ error: (err as Error).message });
    }
  }

  private changed(): void {
    this.emit("push", { type: "update", update: { changed: true } });
  }

  private conversation(key: string): PanelConversation {
    const known = this.s.conversations[key];
    if (known) return known;
    const owner = postingConversation(key);
    const posting = owner && this.s.state.postings.find((p) => p.id === owner.postingId);
    const made: PanelConversation = posting
      ? { key, posting: { ...posting, requirements: [] }, documents: [], events: [] }
      : { key, documents: [], events: [] };
    this.s.conversations[key] = made;
    return made;
  }

  private setStatus(key: string, status: "idle" | "working"): void {
    const agent = this.s.state.agent;
    agent.conversations = agent.conversations.filter((c) => c.conversation !== key);
    if (status === "working") agent.conversations.push({ conversation: key, status, queued: 0 });
    agent.status = agent.conversations.some((c) => c.status === "working") ? "working" : "idle";
  }

  private call(method: string, p: Record<string, unknown>): unknown {
    const st = this.s.state;
    const key = p.key as string;
    switch (method) {
      case "panel.state":
        return st;
      case "panel.conversation":
        return this.conversation(key);
      case "panel.send": {
        const conv = this.conversation(key);
        const id = `m${++this.turn}`;
        const events: AgentEvent[] = [
          { kind: "user", at: AT, id, text: String(p.text), taken: true },
          { kind: "text", at: AT, text: "A canned reply: the fuzzer's agent answers every message the same way." },
          { kind: "turnEnd", at: AT, ok: true, totalCostUsd: 0.01 * this.turn },
        ];
        conv.events.push(...events);
        conv.totalCostUsd = 0.01 * this.turn;
        this.changed();
        return { id };
      }
      case "panel.stop":
        this.setStatus(key, "idle");
        this.conversation(key).events.push({ kind: "turnEnd", at: AT, ok: false, interrupted: true });
        this.changed();
        return { stopped: true };
      case "panel.reset":
        this.conversation(key).events = [];
        this.changed();
        return {};
      case "panel.answer":
      case "panel.reply":
      case "panel.permission": {
        const card = st.cards.find((c) => c.id === p.cardId);
        if (!card) throw new Error("That card was already answered.");
        st.cards = st.cards.filter((c) => c !== card);
        const title = card.kind === "ask" ? card.spec.title : `Approve ${card.toolName}`;
        const outcome = method === "panel.permission" ? (p.allow ? "allowed" : "denied") : "answered";
        if (card.conversation)
          this.conversation(card.conversation).events.push({ kind: "card", at: AT, cardId: card.id, title, outcome });
        this.changed();
        return {};
      }
      case "panel.deletePosting":
        st.postings = st.postings.filter((x) => x.id !== p.postingId);
        this.changed();
        return {};
      case "panel.markSubmitted":
      case "panel.markOpen":
        for (const x of st.postings)
          if (x.id === p.postingId) x.status = method === "panel.markSubmitted" ? "submitted" : "drafting";
        for (const c of Object.values(this.s.conversations))
          if (c.posting && c.posting.id === p.postingId)
            c.posting.status = method === "panel.markSubmitted" ? "submitted" : "drafting";
        this.changed();
        return {};
      case "panel.deleteDocument":
        for (const c of Object.values(this.s.conversations))
          if (c.posting?.id === p.postingId) c.documents = c.documents.filter((d) => d.file !== p.file);
        this.changed();
        return {};
      case "panel.workspaceChanges": {
        const needed = key !== GENERAL_CONVERSATION;
        return {
          ...this.s.changes,
          changes: this.s.changes.changes.map((c) => ({ ...c, needed: needed && c.needed })),
        };
      }
      case "panel.workspaceChange":
        return { outcomes: actOnChanges(this.s.changes, p as unknown as WorkspaceChangeRequest) };
      case "panel.open":
      case "panel.watch":
        return {};
      case "panel.settings":
        return effectiveSettings(p as unknown as AgentPrefs, st.agent.agents);
      default:
        throw new Error(`The fake companion has no ${method}.`);
    }
  }

  /** What the transport asks the extension's background rather than the companion. */
  private side(what: string, arg: unknown): unknown {
    switch (what) {
      case "capture": {
        if (this.s.capture) return this.s.capture;
        // The tab captured: the newest posting again, or a new one when there's none yet.
        let posting = this.s.state.postings[0];
        if (!posting) {
          posting = {
            id: "2026-01-05_example_engineer",
            company: "Example Co",
            role: "Engineer",
            site: "generic",
            status: "captured",
            url: "https://careers.example.com/jobs/REQ-0000",
          };
          this.s.state.postings.push(posting);
        }
        return { ok: true, postingId: posting.id, label: `${posting.company}: ${posting.role}` };
      }
      case "tab":
        return this.s.tab ?? null;
      case "connection":
        return this.s.connection;
      case "prefs":
        return this.s.prefs;
      case "savePrefs":
        this.s.prefs = arg as AgentPrefs;
        this.emit("push", { type: "prefs", prefs: this.s.prefs });
        return null;
      case "openTab":
      case "openSettings":
        return null;
      default:
        throw new Error(`The fake extension has no ${what}.`);
    }
  }
}

/** A choice on the workspace's changes, as the companion takes it: the change leaves the list. */
function actOnChanges(changes: WorkspaceChanges, req: WorkspaceChangeRequest): WorkspaceChangeOutcome[] {
  changes.changes = changes.changes.filter((c) => !req.ids.includes(c.id));
  return req.ids.map((id) => ({
    id,
    outcome: req.pick ? "dialog" : req.action === "update" ? "updated" : req.action,
  }));
}

// ---- the review page ---------------------------------------------------------------------------------------------

interface ReviewSetup {
  state: ReviewPageState;
  /** Each file's bytes, by index. */
  files: Buffer[];
}

export class ReviewFake extends Fake {
  readonly page = "review";
  private readonly state: ReviewPageState;
  private readonly files: Buffer[];

  constructor(setup: ReviewSetup) {
    super();
    this.state = structuredClone(setup.state);
    this.files = setup.files;
  }

  handle(req: FakeRequest): Reply | null {
    this.calls.push(`${req.method} ${req.path}`);
    if (req.method === "GET" && req.path === "state") return ok(this.state);
    const file = /^file\/(\d+)$/.exec(req.path);
    if (req.method === "GET" && file) {
      const bytes = this.files[Number(file[1])];
      if (!bytes) return null;
      return {
        status: 200,
        body: bytes,
        type: "application/pdf",
        headers: req.query.has("download") ? { "Content-Disposition": 'attachment; filename="document.pdf"' } : {},
      };
    }
    if (req.method === "POST" && req.path === "answer") {
      if (this.state.status !== "open") return { status: 409, json: { status: this.state.status } };
      const body = JSON.parse(req.body.toString()) as ReviewAnswerBody;
      if (!Array.isArray(body.documents)) return refused("Not an answer.");
      const name = (i: number) => this.state.files[i]?.name ?? String(i);
      const asks = body.documents.filter((d) => d.request || d.comments?.length);
      this.state.status = "answered";
      this.state.answer = {
        approved: body.documents.filter((d) => !asks.includes(d)).map((d) => name(d.index)),
        changes: asks.map((d) => ({
          file: name(d.index),
          ...(d.request ? { request: d.request } : {}),
          ...(d.comments ? { comments: d.comments } : {}),
        })),
      };
      this.emit("state", {});
      return { status: 204 };
    }
    return null;
  }
}

// ---- the onboarding page -----------------------------------------------------------------------------------------

interface OnboardSetup {
  state: OnboardState;
  repos?: OnboardRepo[];
  /** A template's PDF, served for any path the state names. */
  pdf: Buffer;
  /** How an import or a build comes out. */
  build?: "ok" | "fails";
}

export class OnboardFake extends Fake {
  readonly page = "onboard";
  private readonly s: OnboardState;
  private readonly repos: OnboardRepo[];
  private readonly pdf: Buffer;
  private readonly build: "ok" | "fails";
  private tasks = 0;

  constructor(setup: OnboardSetup) {
    super();
    this.s = structuredClone(setup.state);
    this.repos = structuredClone(setup.repos ?? []);
    this.pdf = setup.pdf;
    this.build = setup.build ?? "ok";
  }

  handle(req: FakeRequest): Reply | null {
    this.calls.push(`${req.method} ${req.path}`);
    if (req.method === "GET") {
      if (req.path === "state") return ok(this.s);
      if (req.path === "repos")
        return ok(this.repos.map((r) => ({ ...r, selected: this.s.repos.selected.includes(r.fullName) })));
      if (req.path === "file") return { status: 200, body: this.pdf, type: "application/pdf" };
      return null;
    }
    if (req.path === "library") {
      const name = req.query.get("name") ?? "file";
      if (!this.s.library.includes(name)) this.s.library.push(name);
      this.changed();
      return ok({ saved: `library/${name}` });
    }
    if (req.path !== "action") return null;
    const { action, ...p } = JSON.parse(req.body.toString() || "{}") as { action: string } & Record<string, unknown>;
    this.calls.push(`action ${action}`);
    const out = this.act(action, p, req.origin);
    this.changed();
    return out;
  }

  private changed(): void {
    this.emit("state", {});
  }

  private step(id: string, done: boolean): void {
    for (const s of this.s.steps) if (s.id === id) s.done = done;
    this.s.ready = this.s.steps.every((s) => s.done || !s.required);
  }

  private compile(kind: "resume" | "cover") {
    if (this.build === "fails")
      return {
        ok: false,
        errors: ["! LaTeX Error: File `fontawesome5.sty' not found."],
        hint: "A package the template needs isn't installed.",
        main: `templates/${kind}/main.tex`,
      };
    return { ok: true, pdf: `templates/${kind}/main.pdf`, pages: 1, ...(kind === "resume" ? { pageLimit: 1 } : {}) };
  }

  private act(action: string, p: Record<string, unknown>, origin: string): Reply {
    const s = this.s;
    switch (action) {
      case "task":
        s.tasks.push({
          id: `t${++this.tasks}`,
          kind: p.kind as OnboardState["tasks"][number]["kind"],
          params: (p.params as Record<string, unknown>) ?? {},
          status: "queued",
          createdAt: AT,
        });
        return ok({});
      case "installTex":
        s.tex.install = { status: "running" };
        return ok({});
      case "pair":
        s.extension.pairingOpen = true;
        return ok({});
      case "github":
        return ok({ url: `${origin}/fuzz/elsewhere` });
      case "repos":
        s.repos.selected = (p.repos as string[]) ?? [];
        this.step("repos", s.repos.selected.length > 0);
        return ok({});
      case "addRepo": {
        const m = /(?:github\.com\/)?([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(String(p.url ?? "").trim());
        if (!m?.[1] || /\s/.test(String(p.url))) return refused("That isn't a GitHub repository's address.");
        this.repos.push({
          source: "public-url",
          fullName: m[1],
          private: false,
          fork: false,
          archived: false,
          language: null,
          sizeKb: 100,
          pushedAt: null,
          description: null,
          stars: 0,
          selected: true,
          suggested: false,
        });
        s.repos.selected.push(m[1]);
        return ok({ added: m[1] });
      }
      case "browse":
        return ok({ path: p.kind === "folder" ? "/home/jane/resume" : "/home/jane/resume/resume.tex" });
      case "import": {
        const kind = p.kind === "cover" ? "cover" : "resume";
        const compile = this.compile(kind);
        if (kind === "resume") {
          s.resume = {
            main: "templates/resume/main.tex",
            source: String(p.source),
            ...("pdf" in compile ? { pdf: compile.pdf, builtAt: AT } : {}),
          };
          this.step("resume", compile.ok);
        }
        return ok({ compile });
      }
      case "compile":
      case "coverIdentity":
        return ok({ compile: this.compile("cover") });
      case "change":
        return ok({
          outcomes: actOnChanges(s.changes, { ...(p as unknown as WorkspaceChangeRequest), action: p.change as never }),
        });
      case "profile":
        s.profile = { ...s.profile, exists: true, valid: true, value: p.value as Record<string, unknown>, errors: [] };
        this.step("profile", true);
        return ok({ ok: true });
      case "answers": {
        const answers = (p.answers as Record<string, string | null>) ?? {};
        s.answers.unanswered = s.answers.unanswered.filter((q) => !answers[q.id]);
        s.answers.answered += Object.values(answers).filter(Boolean).length;
        return ok({});
      }
      case "preferences":
        s.preferences = p as unknown as OnboardState["preferences"];
        this.step("preferences", true);
        return ok({});
      case "notifications":
        s.notifications.turnEnd = Boolean(p.turnEnd);
        return ok({});
      case "deleteLibrary":
        if (!s.library.includes(String(p.name))) return refused("No such file in your library.");
        s.library = s.library.filter((f) => f !== p.name);
        return ok({});
      case "finish":
        s.status = "finished";
        return ok({});
      default:
        return refused(`The fake companion has no ${action}.`);
    }
  }
}

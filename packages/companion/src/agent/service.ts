import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type AgentEvent,
  AgentKind,
  AgentPrefs,
  type AgentSettings,
  type AgentStatus,
  DEFAULT_AGENT_PREFS,
  ErrorCode,
  EzError,
  effectiveSettings,
  GENERAL_CONVERSATION,
  postingConversation,
} from "@ezapply/protocol";
import { z } from "zod";
import type { Logger } from "../logger.js";
import { readJson, writeJsonAtomic } from "../util/fs.js";
import type { Workspace } from "../workspace/workspace.js";
import type { AgentBackend, AgentModelOption, AgentSession } from "./backend.js";
import type { NeedsYou } from "./needs.js";
import type { StreamItem } from "./stream.js";

/** The folder in the workspace that holds the conversations' records and logs. */
const AGENT_DIR = "agent";

const Session = z.object({ sessionId: z.string(), startedAt: z.string(), endedAt: z.string().optional() });
const Conversation = z.object({
  sessionId: z.string(),
  startedAt: z.string(),
  /** The agent the session is with; absent in a record from before there was a choice (Claude Code). */
  agent: AgentKind.default("claude"),
  /** The agent has the session (it answered once), so the next process resumes it. */
  started: z.boolean().default(false),
  /** The agent's own id for the session, when it names its sessions itself (Antigravity). */
  agentSessionId: z.string().optional(),
  totalCostUsd: z.number().optional(),
  /** Sessions ended by Reset, newest last; `claude --resume <id>` still opens them. */
  earlier: z.array(Session).default([]),
});
const ConversationsFile = z.object({
  schemaVersion: z.literal(1),
  conversations: z.record(z.string(), Conversation).default({}),
});
type ConversationsFile = z.infer<typeof ConversationsFile>;
type Conversation = z.infer<typeof Conversation>;

/** One conversation's running process, as the panel shows it. */
interface ConversationState {
  conversation: string;
  status: AgentStatus;
  /** Messages sent that the agent hasn't taken yet. */
  queued: number;
}

/** What the panel shows about the agent: working when any conversation is, and each running process. */
interface AgentState {
  status: AgentStatus;
  conversations: ConversationState[];
}

interface AgentServiceOptions {
  workspace: Workspace;
  needs: NeedsYou;
  log: Logger;
  /**
   * The coding agents installed (Claude Code's is `claudeBackend`, Antigravity's `antigravityBackend`); without one
   * the agent is unavailable (tests, or none installed).
   */
  backends?: Partial<Record<AgentKind, AgentBackend>>;
  env?: NodeJS.ProcessEnv;
}

/** A message written to the agent; `delivery`: what the panel shows for a delivered result instead of its text. */
interface Untaken {
  id: string;
  text: string;
  at: string;
  delivery?: string;
}

interface Live {
  key: string;
  sessionId: string;
  backend: AgentBackend;
  process: AgentSession;
  /** The agent reported the session (its first `init`): a later failure isn't a bad resume. */
  initialized: boolean;
  resumed: boolean;
  busy: boolean;
  /** User messages not taken yet, oldest first. */
  untaken: Untaken[];
  mcpChecked: boolean;
  stopping: boolean;
  /** Settings switches sent and not yet answered: what each was, for a notice if Claude Code refuses it. */
  switching: Map<string, string>;
  /** The effort changed while it worked: end the process after this turn, so the next message starts it anew. */
  restartAfterTurn: boolean;
}

/**
 * The agent behind the panel: the coding agent chosen in the panel (Claude Code or Antigravity), headless, one process per conversation (a posting's two, tailoring its
 * documents and filling its application, or the general one), relaying what it does as events. Conversations run side by side, as many as the user starts: each
 * works on its own posting (the tools resolve it from the session, `PostingsService.ownPosting`), and a form tab is bound to one posting.
 *
 * On disk, in the workspace's `agent/`: `conversations.json` (each conversation's session, earlier sessions ended
 * by Reset) and `<conversation>/<session>.jsonl` (a posting's under `<posting>/<part>/`) (the session's events, for the panel's history).
 * The agent settings are the extension's, held here in memory (`setPrefs`).
 */
export class AgentService {
  /** Each conversation's running process. */
  private readonly live = new Map<string, Live>();
  /** Processes being started, so two sends at once to one conversation start one. */
  private readonly starting = new Map<string, Promise<Live>>();
  private readonly listeners = new Set<(conversation: string, event: AgentEvent) => void>();
  private readonly stateListeners = new Set<() => void>();
  private fileWrites: Promise<unknown> = Promise.resolve();
  private readonly logWrites = new Map<string, Promise<unknown>>();
  /** Log appends not finished yet (`emit` doesn't wait for them): `close` does. */
  private readonly appending = new Set<Promise<void>>();
  /** The extension's agent settings, the defaults until it gives them (on connecting). */
  private prefs: AgentPrefs = DEFAULT_AGENT_PREFS;
  /** Each agent's models, listed once (`AgentBackend.models`), when it has a list. */
  private readonly modelLists = new Map<AgentKind, Promise<AgentModelOption[]>>();
  private readonly listedModels: Partial<Record<AgentKind, AgentModelOption[]>> = {};
  private upgraded: Promise<void> | null = null;
  /** Each conversation's last process asked to end, until it has: the next one starts after it, so two never share a session. */
  private readonly closing = new Map<string, Promise<void>>();

  constructor(private readonly opts: AgentServiceOptions) {
    opts.needs.onSettled((record, outcome) => {
      const key = record.card.conversation;
      if (key)
        this.emit(key, {
          kind: "card",
          at: new Date().toISOString(),
          cardId: record.card.id,
          title: record.title,
          outcome,
        });
    });
  }

  get available(): boolean {
    return this.agents().length > 0;
  }

  /** The agents installed, Claude Code first. */
  agents(): AgentKind[] {
    return AgentKind.options.filter((k) => this.opts.backends?.[k]);
  }

  state(): AgentState {
    if (!this.available) return { status: "unavailable", conversations: [] };
    const conversations = [...this.live.values()].map((l) => ({
      conversation: l.key,
      status: liveStatus(l),
      queued: l.untaken.length,
    }));
    const any = (s: AgentStatus) => conversations.some((c) => c.status === s);
    return { status: any("working") ? "working" : any("starting") ? "starting" : "idle", conversations };
  }

  /** A conversation's status: idle when no process of its runs. */
  statusOf(key: string): AgentStatus {
    if (!this.available) return "unavailable";
    const l = this.live.get(key);
    return l ? liveStatus(l) : "idle";
  }

  /** The agent's name, as its notices give it ("Claude Code"): the one running the conversation, else the one in use. */
  agentName(key?: string): string {
    const l = key ? this.live.get(key) : undefined;
    return l?.backend.name ?? this.opts.backends?.[this.settings().agent]?.name ?? "The agent";
  }

  /** Every event, with its conversation. Returns the function that stops listening. */
  onEvent(fn: (conversation: string, event: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Called when `state()` may have changed. */
  onState(fn: () => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  /** The conversation a Claude Code session belongs to, when it's one of the panel's. */
  async conversationOf(sessionId: string): Promise<string | undefined> {
    await this.upgrade();
    for (const l of this.live.values()) if (l.sessionId === sessionId) return l.key;
    const file = await this.readFile();
    return Object.entries(file.conversations).find(([, c]) => c.sessionId === sessionId)?.[0];
  }

  /** Send the user's message to a conversation, starting (or resuming) its process when none runs. */
  async send(key: string, text: string): Promise<{ id: string }> {
    checkKey(key);
    const body = text.trim();
    if (!body) throw new EzError(ErrorCode.BadRequest, "The message is empty.");
    if (!this.available) throw unavailable();
    await this.upgrade();
    // While a card of this conversation is open, the message answers it, as typing does at Claude Code's own
    // prompts: a question's reply (delivered as its result), or a deny whose reason is the message (the agent sits
    // in the permission call meanwhile, and a message would wait for it).
    const open = this.live.has(key) ? this.opts.needs.newestOpen(key) : undefined;
    if (open) {
      const id = randomUUID().slice(0, 8);
      this.emit(key, { kind: "user", at: new Date().toISOString(), id, text: body, taken: true });
      if (open.kind === "ask") this.opts.needs.reply(open.id, body);
      else this.opts.needs.decide(open.id, false, body);
      return { id };
    }
    return this.write(key, { id: randomUUID().slice(0, 8), text: body, at: new Date().toISOString() });
  }

  /**
   * What a tool call left pending in a panel conversation (an ask's answers, how a review ended), sent to the
   * conversation once `result` settles: a message in an `<ezapply-result>` block that starts its next turn, or joins
   * the running one, resuming its process if it ended. The panel shows its `label` instead of the block. Dropped
   * when the conversation was reset or forgotten meanwhile, since the new session never asked; nothing is sent when
   * `result` settles to null.
   */
  deliverLater(
    key: string,
    what: { tool: string; id: string },
    result: Promise<{ value: object; label: string } | null>,
  ): void {
    void (async () => {
      const asked = (await this.readFile()).conversations[key]?.sessionId;
      const settled = await result;
      if (!settled) return;
      const { value, label } = settled;
      if (!asked || (await this.readFile()).conversations[key]?.sessionId !== asked) {
        this.opts.log.info({ conversation: key, tool: what.tool }, "agent: result for an ended session dropped");
        return;
      }
      const text = `<ezapply-result tool="${what.tool}" id="${what.id}">\n${JSON.stringify(value)}\n</ezapply-result>`;
      await this.write(key, { id: randomUUID().slice(0, 8), text, at: new Date().toISOString(), delivery: label });
    })().catch((err: Error) =>
      this.opts.log.warn({ err: err.message, conversation: key, tool: what.tool }, "agent: couldn't deliver a result"),
    );
  }

  /** Write a message to the conversation's process, started (or resumed) when none runs. */
  private async write(key: string, message: Untaken): Promise<{ id: string }> {
    const live = await this.liveFor(key);
    live.untaken.push(message);
    live.busy = true;
    this.emit(key, shownMessage(message, false));
    live.process.send(message.text);
    this.stateChanged();
    return { id: message.id };
  }

  /**
   * End a conversation's running turn. A tool call already running finishes in the companion, but the agent drops
   * its result. The other conversations go on.
   */
  stop(key: string): boolean {
    const l = this.live.get(key);
    if (!l?.busy) return false;
    l.stopping = true;
    l.process.interrupt();
    return true;
  }

  /**
   * A new conversation for `key`: its process ends, its open cards are withdrawn, and the next message starts a
   * new session. The old session is kept in `earlier` (`claude --resume` opens it).
   */
  async reset(key: string): Promise<void> {
    checkKey(key);
    await this.upgrade();
    this.kill(key);
    this.opts.needs.withdraw(key);
    const { agent } = await this.settings();
    await this.updateFile((f) => renewed(f, key, agent));
    this.stateChanged();
  }

  /**
   * Forget a posting's conversations for good (the posting was deleted): their process ends, their open cards are
   * withdrawn, and their records and logs go (with a single conversation an older build kept under the bare id).
   */
  async forgetPosting(postingId: string): Promise<void> {
    if (!postingConversation(`${postingId}/tailor`))
      throw new EzError(ErrorCode.BadRequest, `Not a posting: ${postingId}`);
    const keys = new Set([postingId, `${postingId}/tailor`, `${postingId}/fill`]);
    for (const key of keys) {
      this.kill(key);
      this.opts.needs.withdraw(key);
    }
    await this.updateFile((f) => ({
      ...f,
      conversations: Object.fromEntries(Object.entries(f.conversations).filter(([k]) => !keys.has(k))),
    }));
    await rm(this.opts.workspace.path(AGENT_DIR, postingId), { recursive: true, force: true });
    this.stateChanged();
  }

  /** A conversation's events so far (its current session), oldest first; a message's latest state wins. */
  async history(key: string, limit = 500): Promise<AgentEvent[]> {
    checkKey(key);
    await this.upgrade();
    const c = (await this.readFile()).conversations[key];
    if (!c) return [];
    let raw: string;
    try {
      raw = await readFile(this.logPath(key, c.sessionId), "utf8");
    } catch {
      return [];
    }
    const events: AgentEvent[] = [];
    const users = new Map<string, number>();
    for (const line of raw.split("\n")) {
      if (!line) continue;
      try {
        const e = JSON.parse(line) as AgentEvent;
        if (e.kind === "user" && users.has(e.id)) {
          events[users.get(e.id) as number] = e;
          continue;
        }
        if (e.kind === "user") users.set(e.id, events.length);
        events.push(e);
      } catch {
        // a line cut short by a crash
      }
    }
    return events.slice(-limit);
  }

  /** The session's spend so far (Claude Code's estimate), when known. */
  async cost(key: string): Promise<number | undefined> {
    await this.upgrade();
    // A turn's cost is written as it ends: read it after that write.
    await this.fileWrites;
    return (await this.readFile()).conversations[key]?.totalCostUsd;
  }

  /** What conversations run with: the extension's settings for the agent in use (`effectiveSettings`). */
  settings(): AgentSettings {
    return effectiveSettings(this.prefs, this.agents());
  }

  /**
   * Each agent's models the panel offers beyond its fixed ones: Antigravity's, from `agy models`, listed the first
   * time they're asked for (it fetches them, so it takes a moment); the state changes once they're in.
   */
  models(): Partial<Record<AgentKind, AgentModelOption[]>> {
    for (const k of this.agents()) {
      const list = this.opts.backends?.[k]?.models;
      if (!list || this.modelLists.has(k)) continue;
      const listing = list().catch((err: unknown) => {
        this.opts.log.warn({ err: String(err), agent: k }, "agent: couldn't list the models");
        return [];
      });
      this.modelLists.set(k, listing);
      void listing.then((models) => {
        this.listedModels[k] = models;
        this.stateChanged();
      });
    }
    return { ...this.listedModels };
  }

  /**
   * The extension's settings, given on connecting and on every change: held for every conversation from now on.
   * The mode and model are switched in the running process at once (Claude Code takes them mid-session, between tool
   * calls); a refusal comes back as a notice. Effort has no switch Claude Code was seen to honour, so the process
   * ends (now if idle, without waiting for its exit, else after its turn) and the next message resumes the session
   * with the new `--effort`; so does any change for an agent that takes no switches (`AgentBackend.switches`), and a
   * change of agent.
   */
  async setPrefs(prefs: AgentPrefs): Promise<AgentSettings> {
    const before = this.settings();
    this.prefs = AgentPrefs.parse(prefs);
    const next = this.settings();
    for (const l of this.live.values()) {
      if (!l.process.alive) continue;
      const switches = l.backend.switches !== false;
      const modeChanged = next.permissionMode !== before.permissionMode;
      const modelChanged = next.model !== before.model;
      if (switches && modeChanged)
        l.switching.set(l.process.setPermissionMode(next.permissionMode), `permission mode to ${next.permissionMode}`);
      if (switches && modelChanged && next.model)
        l.switching.set(l.process.setModel(next.model), `model to ${next.model}`);
      const restart = !switches && (modeChanged || modelChanged);
      if (restart || next.effort !== before.effort || next.agent !== before.agent) {
        if (l.busy) l.restartAfterTurn = true;
        // Not awaited: the panel shows the change at once, and the next message waits for the exit instead.
        else void this.closeLive(l.key);
      }
    }
    if (JSON.stringify(next) !== JSON.stringify(before)) this.opts.log.info({ ...next }, "agent: settings changed");
    return next;
  }

  /** End the running processes (the companion is closing), and finish writing the logs and records. */
  async close(): Promise<void> {
    await Promise.allSettled([...this.starting.values()]);
    await Promise.all([...this.live.keys()].map((key) => this.closeLive(key, 3000)));
    await Promise.all(this.closing.values());
    while (this.appending.size > 0) await Promise.all(this.appending);
    await this.fileWrites;
  }

  // ---- internals ----

  /**
   * Once per run: the general conversation gets its record if it has none, so it's always there to show and reset.
   * And an older build kept one conversation per posting, under the bare posting id. It becomes the posting's
   * tailoring conversation, its logs moved to `<posting>/tailor/`, so its history stays in the panel.
   */
  private upgrade(): Promise<void> {
    this.upgraded ??= (async () => {
      if (!(await this.readFile()).conversations[GENERAL_CONVERSATION]) {
        const { agent } = await this.settings();
        await this.updateFile((f) =>
          f.conversations[GENERAL_CONVERSATION] ? f : renewed(f, GENERAL_CONVERSATION, agent),
        );
      }
      const bare = Object.keys((await this.readFile()).conversations).filter(
        (k) => k !== GENERAL_CONVERSATION && !k.includes("/") && postingConversation(`${k}/tailor`),
      );
      for (const id of bare) {
        const dir = this.opts.workspace.path(AGENT_DIR, id);
        const logs = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".jsonl"));
        await mkdir(join(dir, "tailor"), { recursive: true });
        for (const n of logs) await rename(join(dir, n), join(dir, "tailor", n));
        await this.updateFile((f) => {
          const { [id]: old, ...rest } = f.conversations;
          const key = `${id}/tailor`;
          return { ...f, conversations: old && !rest[key] ? { ...rest, [key]: old } : rest };
        });
      }
    })().catch((err) =>
      this.opts.log.warn({ err: (err as Error).message }, "agent: could not move older conversations"),
    );
    return this.upgraded;
  }

  /** The conversation's running process, or one started for it (once, however many sends wait on it). */
  private liveFor(key: string): Promise<Live> {
    const running = this.live.get(key);
    if (running) return Promise.resolve(running);
    let started = this.starting.get(key);
    if (!started) {
      started = this.start(key).finally(() => this.starting.delete(key));
      this.starting.set(key, started);
    }
    return started;
  }

  /** End a conversation's process at once (Reset, Forget). */
  private kill(key: string): void {
    const l = this.live.get(key);
    if (!l) return;
    this.live.delete(key);
    l.process.kill();
  }

  private async start(key: string, fresh = false): Promise<Live> {
    await this.closing.get(key);
    const settings = await this.settings();
    const backend = this.opts.backends?.[settings.agent];
    if (!backend) throw unavailable();
    const had = (await this.readFile()).conversations[key];
    // A session is with one agent: on another, the conversation starts anew (the old one stays in `earlier`).
    const switched = had?.started && had.agent !== settings.agent;
    if (fresh || !had || switched) await this.updateFile((f) => renewed(f, key, settings.agent));
    if (switched) {
      this.emit(key, {
        kind: "notice",
        at: new Date().toISOString(),
        level: "info",
        text: `A new conversation with ${backend.name}: the earlier one was with another agent.`,
      });
    }
    const c = (await this.readFile()).conversations[key] as Conversation;
    const sessionId = c.sessionId;
    const resumed = c.started;
    const part = postingConversation(key)?.part;
    const live: Live = {
      key,
      sessionId,
      backend,
      process: undefined as unknown as AgentSession,
      initialized: false,
      resumed,
      busy: false,
      untaken: [],
      mcpChecked: false,
      stopping: false,
      switching: new Map(),
      restartAfterTurn: false,
    };
    live.process = backend.start({
      cwd: this.opts.workspace.root,
      sessionId,
      resume: resumed,
      ...(c.agentSessionId ? { agentSessionId: c.agentSessionId } : {}),
      settings,
      ...(part ? { part } : {}),
      ...(this.opts.env ? { env: this.opts.env } : {}),
      onItem: (item) => this.onItem(live, item),
      onExit: (code, tail) => this.onExit(live, code, tail),
    });
    this.live.set(key, live);
    this.opts.log.info({ conversation: key, resumed, agent: backend.name }, "agent: started");
    return live;
  }

  private onItem(l: Live, item: StreamItem): void {
    switch (item.type) {
      case "init": {
        if (!l.initialized) {
          l.initialized = true;
          if (!l.resumed) void this.updateFile((f) => markStarted(f, l.key, l.sessionId));
          this.stateChanged();
        }
        if (!l.mcpChecked && item.mcpServers) {
          l.mcpChecked = true;
          const ours = item.mcpServers.find((s) => s.name === "ezapply");
          if (ours?.status !== "connected") {
            this.emit(l.key, {
              kind: "notice",
              at: new Date().toISOString(),
              level: "error",
              text:
                `ezapply's tools aren't connected to ${l.backend.name} (${ours ? ours.status : "not configured"}). ` +
                "Run `ezapply init` in the workspace, then Reset this conversation.",
            });
          }
        }
        return;
      }
      case "agentSession":
        void this.updateFile((f) => withAgentSession(f, l.key, l.sessionId, item.id));
        return;
      case "taken": {
        const m = l.untaken.shift();
        if (m) this.emit(l.key, shownMessage(m, true));
        this.stateChanged();
        return;
      }
      case "event":
        this.emit(l.key, item.event);
        return;
      case "turnEnd": {
        l.busy = item.queued > 0 || l.untaken.length > 0;
        const event = l.stopping ? { ...item.event, interrupted: true } : item.event;
        l.stopping = false;
        this.emit(l.key, event);
        if (event.totalCostUsd !== undefined) {
          const cost = event.totalCostUsd;
          void this.updateFile((f) => withCost(f, l.key, l.sessionId, cost));
        }
        if (l.restartAfterTurn && !l.busy && this.live.get(l.key) === l) {
          l.restartAfterTurn = false;
          void this.closeLive(l.key);
          return;
        }
        this.stateChanged();
        return;
      }
      case "controlResponse": {
        const what = l.switching.get(item.requestId);
        if (what === undefined) return;
        l.switching.delete(item.requestId);
        if (!item.ok) {
          this.emit(l.key, {
            kind: "notice",
            at: new Date().toISOString(),
            level: "warn",
            text: `${l.backend.name} didn't switch the ${what}${item.error ? `: ${item.error}` : ""}. It applies when this conversation next starts.`,
          });
        }
        return;
      }
    }
  }

  private onExit(l: Live, code: number | null, tail: string): void {
    if (this.live.get(l.key) === l) this.live.delete(l.key);
    const at = new Date().toISOString();
    // A session the agent no longer has (its transcript deleted) can't be resumed: start afresh with the
    // messages that were waiting, once.
    if (l.resumed && !l.initialized && l.untaken.length > 0) {
      this.opts.log.warn({ conversation: l.key, code }, "agent: resume failed; starting a new session");
      const waiting = l.untaken;
      void (async () => {
        this.emit(l.key, {
          kind: "notice",
          at,
          level: "warn",
          text: "The earlier conversation couldn't be reopened, so this is a new one.",
        });
        const fresh = await this.start(l.key, true);
        for (const m of waiting) {
          fresh.untaken.push(m);
          fresh.busy = true;
          fresh.process.send(m.text);
        }
        this.stateChanged();
      })().catch((err) => this.opts.log.error({ err: (err as Error).message }, "agent: restart failed"));
      return;
    }
    if (l.busy || l.untaken.length > 0) {
      const why = tail.split("\n").find((s) => s.trim()) ?? `exit code ${code}`;
      this.opts.log.warn({ conversation: l.key, code }, "agent: exited mid-turn");
      this.emit(l.key, {
        kind: "notice",
        at,
        level: "error",
        text: `${l.backend.name} stopped unexpectedly: ${why.slice(0, 300)}`,
      });
    }
    this.stateChanged();
  }

  private async closeLive(key: string, graceMs?: number): Promise<void> {
    const l = this.live.get(key);
    if (!l) return;
    this.live.delete(key);
    const closing = l.process.close(graceMs);
    this.closing.set(key, closing);
    await closing;
    if (this.closing.get(key) === closing) this.closing.delete(key);
    this.stateChanged();
  }

  private emit(key: string, event: AgentEvent): void {
    const append = this.appendLog(key, event);
    this.appending.add(append);
    void append.finally(() => this.appending.delete(append));
    for (const fn of [...this.listeners]) fn(key, event);
  }

  private async appendLog(key: string, event: AgentEvent): Promise<void> {
    const l = this.live.get(key);
    const c = l ? { sessionId: l.sessionId } : (await this.readFile()).conversations[key];
    if (!c) return;
    const path = this.logPath(key, c.sessionId);
    const prev = this.logWrites.get(path) ?? Promise.resolve();
    const next = prev.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
    });
    this.logWrites.set(
      path,
      next.catch(() => undefined),
    );
    await next.catch((err) => this.opts.log.warn({ err: (err as Error).message }, "agent: could not write the log"));
  }

  private logPath(key: string, sessionId: string): string {
    return this.opts.workspace.path(AGENT_DIR, key, `${sessionId}.jsonl`);
  }

  private async readFile(): Promise<ConversationsFile> {
    const raw = await readJson(this.opts.workspace.path(AGENT_DIR, "conversations.json")).catch(() => null);
    const parsed = ConversationsFile.safeParse(raw ?? { schemaVersion: 1 });
    return parsed.success ? parsed.data : { schemaVersion: 1, conversations: {} };
  }

  /** Read-modify-write of conversations.json, one at a time. */
  private updateFile(change: (f: ConversationsFile) => ConversationsFile): Promise<void> {
    const next = this.fileWrites.then(async () => {
      const value = change(await this.readFile());
      await writeJsonAtomic(this.opts.workspace.path(AGENT_DIR, "conversations.json"), value);
    });
    this.fileWrites = next.catch(() => undefined);
    return next;
  }

  private stateChanged(): void {
    for (const fn of [...this.stateListeners]) fn();
  }
}

function liveStatus(l: Live): AgentStatus {
  return !l.initialized && l.untaken.length > 0 ? "starting" : l.busy ? "working" : "idle";
}

/** A message as the panel shows it: a delivered result by its label. */
function shownMessage(m: Untaken, taken: boolean): AgentEvent {
  return m.delivery
    ? { kind: "user", at: m.at, id: m.id, text: m.delivery, delivery: true, taken }
    : { kind: "user", at: m.at, id: m.id, text: m.text, taken };
}

/** A new session for `key`; the one it had, if Claude Code ever had it, goes to `earlier`. */
function renewed(f: ConversationsFile, key: string, agent: AgentKind): ConversationsFile {
  const now = new Date().toISOString();
  const old = f.conversations[key];
  const earlier = old
    ? [...old.earlier, ...(old.started ? [{ sessionId: old.sessionId, startedAt: old.startedAt, endedAt: now }] : [])]
    : [];
  const next: Conversation = {
    sessionId: randomUUID(),
    startedAt: now,
    agent,
    started: false,
    earlier: earlier.slice(-50),
  };
  return { ...f, conversations: { ...f.conversations, [key]: next } };
}

function markStarted(f: ConversationsFile, key: string, sessionId: string): ConversationsFile {
  const c = f.conversations[key];
  if (!c || c.sessionId !== sessionId) return f;
  return { ...f, conversations: { ...f.conversations, [key]: { ...c, started: true } } };
}

function withAgentSession(f: ConversationsFile, key: string, sessionId: string, id: string): ConversationsFile {
  const c = f.conversations[key];
  if (!c || c.sessionId !== sessionId || c.agentSessionId === id) return f;
  return { ...f, conversations: { ...f.conversations, [key]: { ...c, agentSessionId: id } } };
}

function withCost(f: ConversationsFile, key: string, sessionId: string, cost: number): ConversationsFile {
  const c = f.conversations[key];
  if (!c || c.sessionId !== sessionId) return f;
  return { ...f, conversations: { ...f.conversations, [key]: { ...c, totalCostUsd: cost } } };
}

/** A posting's conversation (`<posting id>/<part>`, the id a plain folder name) or the general one. */
function checkKey(key: string): void {
  if (key === GENERAL_CONVERSATION || postingConversation(key)) return;
  throw new EzError(ErrorCode.BadRequest, `Not a conversation: ${key}`);
}

function unavailable(): EzError {
  return new EzError(
    ErrorCode.BadRequest,
    "No coding agent is available to ezapply.",
    "Install Claude Code (https://claude.com/claude-code) or the Antigravity CLI, and start ezapply again.",
  );
}

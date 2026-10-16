import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  AgentEffort,
  type AgentEvent,
  AgentKind,
  AgentModel,
  AgentPermissionMode,
  AgentSettings,
  type AgentStatus,
  DEFAULT_AGENT_SETTINGS,
  ErrorCode,
  EzError,
  GENERAL_CONVERSATION,
  postingConversation,
} from "@ezapply/protocol";
import { z } from "zod";
import type { Logger } from "../logger.js";
import { readJson, writeJsonAtomic } from "../util/fs.js";
import type { Workspace } from "../workspace/workspace.js";
import type { AgentBackend, AgentSession } from "./backend.js";
import type { NeedsYou } from "./needs.js";
import type { StreamItem } from "./stream.js";

/** The folder in the workspace that holds the conversations' records and logs. */
export const AGENT_DIR = "agent";

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

/** What the panel shows about the agent. */
export interface AgentState {
  status: AgentStatus;
  /** The conversation whose process is running, if one is. */
  conversation?: string;
  /** Messages sent that Claude hasn't taken yet. */
  queued: number;
}

export interface AgentServiceOptions {
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
  untaken: { id: string; text: string; at: string }[];
  mcpChecked: boolean;
  stopping: boolean;
  /** Settings switches sent and not yet answered: what each was, for a notice if Claude Code refuses it. */
  switching: Map<string, string>;
  /** The effort changed while it worked: end the process after this turn, so the next message starts it anew. */
  restartAfterTurn: boolean;
}

/**
 * The agent behind the panel: the coding agent chosen in the panel (Claude Code or Antigravity), headless, one process per conversation (a posting's two, tailoring its
 * documents and filling its application, or the general one), relaying what it does as events. One process runs at a time: switching conversations closes an idle one,
 * and refuses while it works, since two agents filling forms or editing one posting's files would collide.
 *
 * On disk, in the workspace's `agent/`: `conversations.json` (each conversation's session, earlier sessions ended
 * by Reset), `<conversation>/<session>.jsonl` (a posting's under `<posting>/<part>/`) (the session's events, for the panel's history) and `settings.json`
 * (the permission mode and model chosen in the panel).
 */
export class AgentService {
  private live: Live | null = null;
  private readonly listeners = new Set<(conversation: string, event: AgentEvent) => void>();
  private readonly stateListeners = new Set<() => void>();
  private fileWrites: Promise<unknown> = Promise.resolve();
  private readonly logWrites = new Map<string, Promise<unknown>>();
  private current: AgentSettings | null = null;
  private upgraded: Promise<void> | null = null;

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
    if (!this.available) return { status: "unavailable", queued: 0 };
    const l = this.live;
    if (!l) return { status: "idle", queued: 0 };
    const status: AgentStatus = !l.initialized && l.untaken.length > 0 ? "starting" : l.busy ? "working" : "idle";
    return { status, conversation: l.key, queued: l.untaken.length };
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
    if (this.live?.sessionId === sessionId) return this.live.key;
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
    // While a card of this conversation is open, Claude sits in the tool call that asked, and a message sent to it
    // would wait for that call (up to 10 minutes). So the message answers the card: a question's reply, or a deny
    // whose reason is the message, as typing does at Claude Code's own prompts.
    const open = this.live?.key === key ? this.opts.needs.newestOpen(key) : undefined;
    if (open) {
      const id = randomUUID().slice(0, 8);
      this.emit(key, { kind: "user", at: new Date().toISOString(), id, text: body, taken: true });
      if (open.kind === "ask") this.opts.needs.reply(open.id, body);
      else this.opts.needs.decide(open.id, false, body);
      return { id };
    }
    if (this.live && this.live.key !== key) {
      if (this.live.busy) {
        throw new EzError(
          ErrorCode.BadRequest,
          `${this.live.backend.name} is still working in another conversation.`,
          "Stop it, or wait until it's done, then send this again.",
        );
      }
      await this.closeLive();
    }
    const live = this.live ?? (await this.start(key));
    const message = { id: randomUUID().slice(0, 8), text: body, at: new Date().toISOString() };
    live.untaken.push(message);
    live.busy = true;
    this.emit(key, { kind: "user", at: message.at, id: message.id, text: body, taken: false });
    live.process.send(body);
    this.stateChanged();
    return { id: message.id };
  }

  /** End the running turn. A tool call already running finishes in the companion, but Claude drops its result. */
  stop(): boolean {
    const l = this.live;
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
    if (this.live?.key === key) {
      this.live.process.kill();
      this.live = null;
    }
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
    if (this.live && keys.has(this.live.key)) {
      this.live.process.kill();
      this.live = null;
    }
    for (const key of keys) this.opts.needs.withdraw(key);
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

  /**
   * The permission mode, model and effort conversations run with (`agent/settings.json`). Each is read on its own:
   * one missing or no longer offered (an older build's `model: "default"`) falls back to its default alone.
   */
  async settings(): Promise<AgentSettings> {
    if (this.current) return this.current;
    const raw = await readJson(this.settingsPath()).catch(() => null);
    const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const d = DEFAULT_AGENT_SETTINGS;
    const agents = this.agents();
    const agent = AgentKind.catch(d.agent).parse(o.agent);
    this.current = {
      // An agent no longer installed: the first one that is.
      agent: agents.includes(agent) ? agent : (agents[0] ?? agent),
      permissionMode: AgentPermissionMode.catch(d.permissionMode).parse(o.permissionMode),
      model: AgentModel.catch(d.model).parse(o.model),
      effort: AgentEffort.catch(d.effort).parse(o.effort),
    };
    return this.current;
  }

  /**
   * Change the settings: kept for every conversation from now on. The mode and model are switched in the running
   * process at once (Claude Code takes them mid-session, between tool calls); a refusal comes back as a notice.
   * Effort has no switch Claude Code was seen to honour, so the process ends (now if idle, else after its turn) and
   * the next message resumes the session with the new `--effort`; so does any change for an agent that takes no
   * switches (`AgentBackend.switches`), and a change of agent.
   */
  async setSettings(change: Partial<AgentSettings>): Promise<AgentSettings> {
    const before = await this.settings();
    const next = AgentSettings.parse({ ...before, ...change });
    if (!this.agents().includes(next.agent))
      throw new EzError(ErrorCode.BadRequest, `${next.agent} isn't installed.`, "Install it and start ezapply again.");
    await writeJsonAtomic(this.settingsPath(), { schemaVersion: 1, ...next });
    this.current = next;
    const l = this.live;
    if (l?.process.alive) {
      const switches = l.backend.switches !== false;
      const modeChanged = next.permissionMode !== before.permissionMode;
      const modelChanged = next.model !== before.model;
      if (switches && modeChanged)
        l.switching.set(l.process.setPermissionMode(next.permissionMode), `permission mode to ${next.permissionMode}`);
      if (switches && modelChanged) l.switching.set(l.process.setModel(next.model), `model to ${next.model}`);
      const restart = !switches && (modeChanged || modelChanged);
      if (restart || next.effort !== before.effort || next.agent !== before.agent) {
        if (l.busy) l.restartAfterTurn = true;
        else await this.closeLive();
      }
    }
    this.opts.log.info({ ...next }, "agent: settings changed");
    this.stateChanged();
    return next;
  }

  /** End the running process (the companion is closing). */
  async close(): Promise<void> {
    await this.closeLive(3000);
  }

  // ---- internals ----

  /**
   * Once per run: an older build kept one conversation per posting, under the bare posting id. It becomes the
   * posting's tailoring conversation, its logs moved to `<posting>/tailor/`, so its history stays in the panel.
   */
  private upgrade(): Promise<void> {
    this.upgraded ??= (async () => {
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

  private async start(key: string, fresh = false): Promise<Live> {
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
    this.live = live;
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
        if (m) this.emit(l.key, { kind: "user", at: m.at, id: m.id, text: m.text, taken: true });
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
        if (l.restartAfterTurn && !l.busy && this.live === l) {
          l.restartAfterTurn = false;
          void this.closeLive();
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
    if (this.live === l) this.live = null;
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

  private async closeLive(graceMs?: number): Promise<void> {
    const l = this.live;
    if (!l) return;
    this.live = null;
    await l.process.close(graceMs);
    this.stateChanged();
  }

  private emit(key: string, event: AgentEvent): void {
    void this.appendLog(key, event);
    for (const fn of [...this.listeners]) fn(key, event);
  }

  private async appendLog(key: string, event: AgentEvent): Promise<void> {
    const c = this.live?.key === key ? { sessionId: this.live.sessionId } : (await this.readFile()).conversations[key];
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

  private settingsPath(): string {
    return this.opts.workspace.path(AGENT_DIR, "settings.json");
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

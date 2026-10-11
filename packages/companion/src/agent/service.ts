import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
  AgentEffort,
  type AgentEvent,
  AgentModel,
  AgentPermissionMode,
  AgentSettings,
  type AgentStatus,
  DEFAULT_AGENT_SETTINGS,
  ErrorCode,
  EzError,
  GENERAL_CONVERSATION,
} from "@ezapply/protocol";
import { z } from "zod";
import type { Logger } from "../logger.js";
import { readJson, writeJsonAtomic } from "../util/fs.js";
import type { Workspace } from "../workspace/workspace.js";
import type { NeedsYou } from "./needs.js";
import { AgentProcess, type ClaudeCommand } from "./process.js";
import type { StreamItem } from "./stream.js";

/** The folder in the workspace that holds the conversations' records and logs. */
export const AGENT_DIR = "agent";

const Session = z.object({ sessionId: z.string(), startedAt: z.string(), endedAt: z.string().optional() });
const Conversation = z.object({
  sessionId: z.string(),
  startedAt: z.string(),
  /** Claude Code has the session (it answered once), so the next process resumes it. */
  started: z.boolean().default(false),
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
  /** Claude Code; without it the agent is unavailable (tests, or Claude Code not installed). */
  claude?: ClaudeCommand;
  env?: NodeJS.ProcessEnv;
}

interface Live {
  key: string;
  sessionId: string;
  process: AgentProcess;
  /** Claude Code reported the session (its first `init`): a later failure isn't a bad resume. */
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
 * The agent behind the panel: Claude Code, headless, one process per conversation (a posting's, or the general
 * one), relaying what it does as events. One process runs at a time: switching conversations closes an idle one,
 * and refuses while it works, since two agents filling forms or editing one posting's files would collide.
 *
 * On disk, in the workspace's `agent/`: `conversations.json` (each conversation's session, earlier sessions ended
 * by Reset), `<conversation>/<session>.jsonl` (the session's events, for the panel's history) and `settings.json`
 * (the permission mode and model chosen in the panel).
 */
export class AgentService {
  private live: Live | null = null;
  private readonly listeners = new Set<(conversation: string, event: AgentEvent) => void>();
  private readonly stateListeners = new Set<() => void>();
  private fileWrites: Promise<unknown> = Promise.resolve();
  private readonly logWrites = new Map<string, Promise<unknown>>();
  private current: AgentSettings | null = null;

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
    return Boolean(this.opts.claude);
  }

  state(): AgentState {
    if (!this.opts.claude) return { status: "unavailable", queued: 0 };
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
    if (this.live?.sessionId === sessionId) return this.live.key;
    const file = await this.readFile();
    return Object.entries(file.conversations).find(([, c]) => c.sessionId === sessionId)?.[0];
  }

  /** Send the user's message to a conversation, starting (or resuming) its process when none runs. */
  async send(key: string, text: string): Promise<{ id: string }> {
    checkKey(key);
    const body = text.trim();
    if (!body) throw new EzError(ErrorCode.BadRequest, "The message is empty.");
    const claude = this.opts.claude;
    if (!claude) throw unavailable();
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
          "Claude is still working in another conversation.",
          "Stop it, or wait until it's done, then send this again.",
        );
      }
      await this.closeLive();
    }
    const live = this.live ?? (await this.start(key, claude));
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
    if (this.live?.key === key) {
      this.live.process.kill();
      this.live = null;
    }
    this.opts.needs.withdraw(key);
    await this.updateFile((f) => renewed(f, key));
    this.stateChanged();
  }

  /**
   * Forget a conversation for good (its posting was deleted): its process ends, its open cards are withdrawn, and its
   * record and logs go.
   */
  async forget(key: string): Promise<void> {
    checkKey(key);
    if (this.live?.key === key) {
      this.live.process.kill();
      this.live = null;
    }
    this.opts.needs.withdraw(key);
    await this.updateFile((f) => {
      const { [key]: _, ...rest } = f.conversations;
      return { ...f, conversations: rest };
    });
    await rm(this.opts.workspace.path(AGENT_DIR, key), { recursive: true, force: true });
    this.stateChanged();
  }

  /** A conversation's events so far (its current session), oldest first; a message's latest state wins. */
  async history(key: string, limit = 500): Promise<AgentEvent[]> {
    checkKey(key);
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
    this.current = {
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
   * the next message resumes the session with the new `--effort`.
   */
  async setSettings(change: Partial<AgentSettings>): Promise<AgentSettings> {
    const before = await this.settings();
    const next = AgentSettings.parse({ ...before, ...change });
    await writeJsonAtomic(this.settingsPath(), { schemaVersion: 1, ...next });
    this.current = next;
    const l = this.live;
    if (l?.process.alive) {
      if (next.permissionMode !== before.permissionMode)
        l.switching.set(l.process.setPermissionMode(next.permissionMode), `permission mode to ${next.permissionMode}`);
      if (next.model !== before.model) l.switching.set(l.process.setModel(next.model), `model to ${next.model}`);
      if (next.effort !== before.effort) {
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

  private async start(key: string, claude: ClaudeCommand, fresh = false): Promise<Live> {
    if (fresh || !(await this.readFile()).conversations[key]) await this.updateFile((f) => renewed(f, key));
    const c = (await this.readFile()).conversations[key] as Conversation;
    const sessionId = c.sessionId;
    const resumed = c.started;
    const settings = await this.settings();
    const live: Live = {
      key,
      sessionId,
      process: undefined as unknown as AgentProcess,
      initialized: false,
      resumed,
      busy: false,
      untaken: [],
      mcpChecked: false,
      stopping: false,
      switching: new Map(),
      restartAfterTurn: false,
    };
    live.process = new AgentProcess({
      claude,
      cwd: this.opts.workspace.root,
      sessionId,
      resume: resumed,
      settings,
      ...(this.opts.env ? { env: this.opts.env } : {}),
      onItem: (item) => this.onItem(live, item),
      onExit: (code, tail) => this.onExit(live, code, tail),
    });
    this.live = live;
    this.opts.log.info({ conversation: key, resumed }, "agent: started Claude Code");
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
        if (!l.mcpChecked) {
          l.mcpChecked = true;
          const ours = item.mcpServers.find((s) => s.name === "ezapply");
          if (ours?.status !== "connected") {
            this.emit(l.key, {
              kind: "notice",
              at: new Date().toISOString(),
              level: "error",
              text:
                `ezapply's tools aren't connected to Claude (${ours ? ours.status : "not configured"}). ` +
                "Run `ezapply init` in the workspace, then Reset this conversation.",
            });
          }
        }
        return;
      }
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
            text: `Claude Code didn't switch the ${what}${item.error ? `: ${item.error}` : ""}. It applies when this conversation next starts.`,
          });
        }
        return;
      }
    }
  }

  private onExit(l: Live, code: number | null, tail: string): void {
    if (this.live === l) this.live = null;
    const at = new Date().toISOString();
    // A session Claude Code no longer has (its transcript deleted) can't be resumed: start afresh with the
    // messages that were waiting, once.
    if (l.resumed && !l.initialized && l.untaken.length > 0 && this.opts.claude) {
      this.opts.log.warn({ conversation: l.key, code }, "agent: resume failed; starting a new session");
      const waiting = l.untaken;
      void (async () => {
        this.emit(l.key, {
          kind: "notice",
          at,
          level: "warn",
          text: "The earlier conversation couldn't be reopened, so this is a new one.",
        });
        const fresh = await this.start(l.key, this.opts.claude as ClaudeCommand, true);
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
      this.opts.log.warn({ conversation: l.key, code }, "agent: Claude Code exited mid-turn");
      this.emit(l.key, {
        kind: "notice",
        at,
        level: "error",
        text: `Claude Code stopped unexpectedly: ${why.slice(0, 300)}`,
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
function renewed(f: ConversationsFile, key: string): ConversationsFile {
  const now = new Date().toISOString();
  const old = f.conversations[key];
  const earlier = old
    ? [...old.earlier, ...(old.started ? [{ sessionId: old.sessionId, startedAt: old.startedAt, endedAt: now }] : [])]
    : [];
  const next: Conversation = { sessionId: randomUUID(), startedAt: now, started: false, earlier: earlier.slice(-50) };
  return { ...f, conversations: { ...f.conversations, [key]: next } };
}

function markStarted(f: ConversationsFile, key: string, sessionId: string): ConversationsFile {
  const c = f.conversations[key];
  if (!c || c.sessionId !== sessionId) return f;
  return { ...f, conversations: { ...f.conversations, [key]: { ...c, started: true } } };
}

function withCost(f: ConversationsFile, key: string, sessionId: string, cost: number): ConversationsFile {
  const c = f.conversations[key];
  if (!c || c.sessionId !== sessionId) return f;
  return { ...f, conversations: { ...f.conversations, [key]: { ...c, totalCostUsd: cost } } };
}

/** A posting id (a plain folder name) or the general conversation. */
function checkKey(key: string): void {
  if (key === GENERAL_CONVERSATION) return;
  if (!/^[A-Za-z0-9_.-]+$/.test(key) || key.startsWith(".") || key.includes("..")) {
    throw new EzError(ErrorCode.BadRequest, `Not a conversation: ${key}`);
  }
}

function unavailable(): EzError {
  return new EzError(
    ErrorCode.BadRequest,
    "Claude Code isn't available to ezapply.",
    "Install Claude Code (https://claude.com/claude-code) and start ezapply again.",
  );
}

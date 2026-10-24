import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentEffort, AgentEvent, AgentPermissionMode, AgentSettings, ConversationPart } from "@ezapply/protocol";
import { SESSION_ENV } from "../endpoints.js";
import { COMPANION_VERSION } from "../version.js";
import type { AgentBackend, AgentModelOption, AgentSession, AgentSessionOptions, ApprovalRequest } from "./backend.js";
import { type AgentCommand, findCommand, LineProcess } from "./child.js";
import { PANEL_PROMPT, PART_PROMPTS } from "./process.js";
import { type StreamItem, toolSummary } from "./stream.js";

/** Codex on PATH, or the file EZAPPLY_CODEX names. */
export function findCodex(env: NodeJS.ProcessEnv = process.env, platform = process.platform): AgentCommand | null {
  return findCommand("codex", "EZAPPLY_CODEX", env, platform);
}

/**
 * Codex as the panel's agent, through its app server: one `CodexProcess` per conversation. It takes the mode, model
 * and effort on every turn, so a change applies from the next turn without a restart; its models depend on the
 * account, so they're listed (`model/list`).
 */
export function codexBackend(command: AgentCommand): AgentBackend {
  return {
    name: "Codex",
    start: (opts) => new CodexProcess({ ...opts, command }),
    models: (env) => codexModels(command, env),
  };
}

/**
 * `codex app-server` (JSON-RPC over stdio, one process for the conversation): not `codex exec`, which runs one prompt
 * per process and can't ask for approval. Without the user's plugins and connectors (`apps`): their skills and tools
 * cost tokens on every call, and a document plugin competes with ezapply's skills; without `notify`, the user's
 * program run at each turn's end.
 */
export const CODEX_ARGS = ["app-server", "--disable", "plugins", "--disable", "apps", "-c", "notify=[]"];

/**
 * How each panel mode runs in Codex: its approval policy, who reviews an approval, and the sandbox.
 * - Ask first: `untrusted`, so anything but a known read-only command, and every edit, asks on the panel.
 * - Accept edits: `on-request` in the workspace's sandbox: edits and commands inside it go ahead, and what would
 *   leave it (another folder, the network) asks.
 * - Auto: the same, with Codex's automatic reviewer deciding instead of the user.
 * - Plan only: read-only, nothing asks (a write fails).
 * - Don't ask: the workspace's sandbox, nothing asks: what would leave it fails.
 */
export function codexPolicy(mode: AgentPermissionMode): {
  approvalPolicy: "untrusted" | "on-request" | "never";
  approvalsReviewer: "user" | "auto_review";
  sandbox: "workspace-write" | "read-only";
} {
  switch (mode) {
    case "default":
      return { approvalPolicy: "untrusted", approvalsReviewer: "user", sandbox: "workspace-write" };
    case "acceptEdits":
      return { approvalPolicy: "on-request", approvalsReviewer: "user", sandbox: "workspace-write" };
    case "auto":
      return { approvalPolicy: "on-request", approvalsReviewer: "auto_review", sandbox: "workspace-write" };
    case "plan":
      return { approvalPolicy: "never", approvalsReviewer: "user", sandbox: "read-only" };
    case "dontAsk":
      return { approvalPolicy: "never", approvalsReviewer: "user", sandbox: "workspace-write" };
  }
}

/** The sandbox as a turn takes it (a thread takes its name, a turn this policy). */
function sandboxPolicy(sandbox: "workspace-write" | "read-only"): object {
  return sandbox === "read-only"
    ? { type: "readOnly", networkAccess: false }
    : {
        type: "workspaceWrite",
        writableRoots: [],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
}

/**
 * What Claude Code's permission rules hold in the workspace (`ezapply init` writes them in `.claude/settings.json`),
 * which Codex has no setting for: so its instructions say them.
 */
export const CODEX_RULES =
  "The workspace's rules: never write under repo-cache/ (read-only clones of the user's repos); don't read debug/ " +
  "(debug output, not for applying); edit files with your edit tool, never with a Python script, which mangles " +
  "LaTeX's backslashes.";

/** Before a Plan only turn's message: Codex's read-only sandbox doesn't stop ezapply's tools. */
export const PLAN_LINE =
  "[Plan only: read and plan, and change nothing: no edits, and no ezapply tool that fills a form, " +
  "writes a document or changes a posting.]";

/**
 * The thread's developer instructions: the panel's prompt and the part's line, the workspace's rules, then
 * `EZAPPLY.md` and the user's preferences. Codex reads `AGENTS.md` itself, but not the files it includes (that
 * syntax is Antigravity's), so they come here, as `CLAUDE.md` imports them for Claude Code.
 */
export function codexInstructions(cwd: string, part?: ConversationPart): string {
  const read = (file: string) => {
    try {
      return readFileSync(join(cwd, file), "utf8").trim();
    } catch {
      return "";
    }
  };
  const prompt = part ? `${PANEL_PROMPT} ${PART_PROMPTS[part]}` : PANEL_PROMPT;
  const ezapply = read("EZAPPLY.md");
  const preferences = read(join("profile", "preferences.md"));
  return [
    prompt,
    CODEX_RULES,
    ...(ezapply ? [ezapply] : []),
    ...(preferences ? [`# The user's preferences (profile/preferences.md)\n\n${preferences}`] : []),
  ].join("\n\n");
}

/** ezapply's server as `.mcp.json` names it (`ezapply init` writes it), or null when it isn't there. */
export function workspaceServer(cwd: string): { command: string; args: string[] } | null {
  try {
    const raw = JSON.parse(readFileSync(join(cwd, ".mcp.json"), "utf8")) as {
      mcpServers?: Record<string, { command?: unknown; args?: unknown }>;
    };
    const s = raw.mcpServers?.ezapply;
    if (typeof s?.command !== "string") return null;
    const args = Array.isArray(s.args) ? s.args.filter((a): a is string => typeof a === "string") : [];
    return { command: s.command, args };
  } catch {
    return null;
  }
}

/** How long one ezapply call may take: a TeX build or a repo sync runs well past Codex's 60-second default. */
const TOOL_TIMEOUT_SEC = 3600;

/**
 * The thread's MCP servers: ezapply's, with its session for the relay and its calls approved (Codex asks for every
 * MCP call otherwise, and fails it where nobody can approve); every server of the user's own turned off.
 */
export function codexServers(
  userServers: string[],
  ezapply: { command: string; args: string[] } | null,
  sessionId: string,
): Record<string, object> {
  const servers: Record<string, object> = Object.fromEntries(userServers.map((name) => [name, { enabled: false }]));
  if (ezapply) {
    servers.ezapply = {
      command: ezapply.command,
      args: ezapply.args,
      env: { [SESSION_ENV]: sessionId },
      default_tools_approval_mode: "approve",
      tool_timeout_sec: TOOL_TIMEOUT_SEC,
      enabled: true,
    };
  }
  return servers;
}

/** A message's input: a skill the message starts with (`/ezapply-resume …`, as the panel's buttons write) and the text. */
export function codexInput(cwd: string, text: string, mode?: AgentPermissionMode): object[] {
  const items: object[] = [];
  const skill = /^\/([a-z0-9][a-z0-9-]*)\b/.exec(text)?.[1];
  const path = skill ? join(cwd, ".agents", "skills", skill, "SKILL.md") : undefined;
  if (skill && path && existsSync(path)) items.push({ type: "skill", name: skill, path });
  if (mode === "plan") items.push({ type: "text", text: PLAN_LINE, text_elements: [] });
  items.push({ type: "text", text, text_elements: [] });
  return items;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : undefined;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A JSON-RPC peer over a `LineProcess`: requests out, their responses back, and the server's own requests. */
class Rpc {
  private seq = 0;
  private readonly pending = new Map<number, { resolve: (v: Json) => void; reject: (e: Error) => void }>();

  constructor(private readonly write: (o: unknown) => void) {}

  request(method: string, params: object): Promise<Json> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: object): void {
    this.write({ method, ...(params ? { params } : {}) });
  }

  respond(id: unknown, result: object): void {
    this.write({ id, result });
  }

  refuse(id: unknown, message: string): void {
    this.write({ id, error: { code: -32601, message } });
  }

  /** A response to one of ours: settles its request. False for anything else. */
  settle(m: Json): boolean {
    if (m.method !== undefined || typeof m.id !== "number") return false;
    const p = this.pending.get(m.id);
    if (!p) return true;
    this.pending.delete(m.id);
    const error = obj(m.error);
    if (error) p.reject(new Error(str(error.message) ?? "request failed"));
    else p.resolve(obj(m.result) ?? {});
    return true;
  }

  /** The process ended: nothing pending will be answered. */
  close(): void {
    for (const p of this.pending.values()) p.reject(new Error("Codex exited"));
    this.pending.clear();
  }
}

/** How long listing the models may take: it starts an app server and fetches them. */
const MODELS_TIMEOUT_MS = 30_000;

/** The models `model/list` gives, by the id a turn takes and their name. Empty when it fails or takes too long. */
export function codexModels(command: AgentCommand, env: NodeJS.ProcessEnv = process.env): Promise<AgentModelOption[]> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (models: AgentModelOption[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(models);
      child.kill();
    };
    const rpc = new Rpc((o) => child.write(o));
    const child = new LineProcess({
      command,
      args: CODEX_ARGS,
      cwd: process.cwd(),
      env,
      onLine: (line) => {
        try {
          rpc.settle(JSON.parse(line) as Json);
        } catch {
          // not JSON
        }
      },
      onExit: () => {
        rpc.close();
        finish([]);
      },
    });
    const timer = setTimeout(() => finish([]), MODELS_TIMEOUT_MS);
    timer.unref();
    void (async () => {
      await rpc.request("initialize", initializeParams());
      rpc.notify("initialized");
      const list = await rpc.request("model/list", {});
      const models = (Array.isArray(list.data) ? list.data : []).flatMap((m) => {
        const o = obj(m);
        const id = str(o?.model) ?? str(o?.id);
        return id && o?.hidden !== true ? [{ id, label: str(o?.displayName) ?? id }] : [];
      });
      finish(models);
    })().catch(() => finish([]));
  });
}

function initializeParams(): object {
  return {
    clientInfo: { name: "ezapply", title: "ezapply", version: COMPANION_VERSION },
    capabilities: { experimentalApi: true, requestAttestation: false },
  };
}

interface CodexProcessOptions extends AgentSessionOptions {
  command: AgentCommand;
}

/**
 * One conversation's `codex app-server`. It boots (initialize, the user's MCP servers read so they can be turned off,
 * the thread started or resumed), then each message is a `turn/start`, or a `turn/steer` into the running turn, which
 * Codex takes in that turn even while a tool call runs. Mode, model and effort go with every `turn/start`, so a change
 * applies from the next turn. Its approvals come to the client as requests, shown as the panel's cards.
 */
class CodexProcess implements AgentSession {
  private readonly child: LineProcess;
  private readonly rpc: Rpc;
  private readonly reader: CodexReader;
  private settings: AgentSettings;
  private threadId: string | undefined;
  private turnId: string | undefined;
  /** Turns already completed, so a `turn/start` answered after its turn ended doesn't mark it running. */
  private readonly ended = new Set<string>();
  /** Messages and stops, in order, after the thread is ready. */
  private chain: Promise<void>;
  private controlSeq = 0;
  private denySeq = 0;

  constructor(private readonly opts: CodexProcessOptions) {
    this.settings = opts.settings;
    this.reader = new CodexReader();
    this.rpc = new Rpc((o) => this.child.write(o));
    this.child = new LineProcess({
      command: opts.command,
      args: CODEX_ARGS,
      cwd: opts.cwd,
      env: { ...(opts.env ?? process.env), [SESSION_ENV]: opts.sessionId },
      onLine: (line) => this.onLine(line),
      onExit: (code, tail) => {
        this.rpc.close();
        opts.onExit(code, tail);
      },
    });
    this.chain = this.boot().catch((err: Error) => {
      // A thread that can't be resumed exits without reporting a session, so the service starts a new one.
      if (!this.threadId && opts.resume) {
        this.child.kill();
        return;
      }
      opts.onItem(notice("error", `Codex couldn't start the conversation: ${err.message}`));
      this.child.kill();
    });
  }

  get alive(): boolean {
    return this.child.alive;
  }

  send(text: string): void {
    this.chain = this.chain.then(() => this.deliver(text)).catch(() => undefined);
  }

  interrupt(): void {
    this.chain = this.chain
      .then(async () => {
        if (this.threadId && this.turnId)
          await this.rpc.request("turn/interrupt", { threadId: this.threadId, turnId: this.turnId });
      })
      .catch(() => undefined);
  }

  setPermissionMode(mode: AgentPermissionMode): string {
    this.settings = { ...this.settings, permissionMode: mode };
    return this.switched();
  }

  setModel(model: string): string {
    this.settings = { ...this.settings, model };
    return this.switched();
  }

  setEffort(effort: AgentEffort): string {
    this.settings = { ...this.settings, effort };
    return this.switched();
  }

  close(graceMs?: number): Promise<void> {
    return this.child.close(graceMs);
  }

  kill(): void {
    this.child.kill();
  }

  /** A switch is taken for the next turn: answered at once, after the caller has recorded its id. */
  private switched(): string {
    const id = `switch-${++this.controlSeq}`;
    queueMicrotask(() => this.opts.onItem({ type: "controlResponse", requestId: id, ok: true }));
    return id;
  }

  private async boot(): Promise<void> {
    const { cwd } = this.opts;
    await this.rpc.request("initialize", initializeParams());
    this.rpc.notify("initialized");
    const config = obj((await this.rpc.request("config/read", { cwd })).config);
    const userServers = Object.keys(obj(config?.mcp_servers) ?? {}).filter((n) => n !== "ezapply");
    const ezapply = workspaceServer(cwd);
    const policy = codexPolicy(this.settings.permissionMode);
    const params = {
      cwd,
      approvalPolicy: policy.approvalPolicy,
      approvalsReviewer: policy.approvalsReviewer,
      sandbox: policy.sandbox,
      ...(this.settings.model ? { model: this.settings.model } : {}),
      developerInstructions: codexInstructions(cwd, this.opts.part),
      config: {
        model_reasoning_effort: this.settings.effort,
        mcp_servers: codexServers(userServers, ezapply, this.opts.sessionId),
      },
    };
    const resume = this.opts.resume && this.opts.agentSessionId;
    const r = resume
      ? await this.rpc.request("thread/resume", { ...params, threadId: this.opts.agentSessionId, excludeTurns: true })
      : await this.rpc.request("thread/start", params);
    const id = str(obj(r.thread)?.id);
    if (!id) throw new Error("no thread id");
    this.threadId = id;
    for (const item of this.reader.started(id, ezapply !== null)) this.opts.onItem(item);
  }

  /** A message: into the running turn when there is one (falling back to a new turn if it just ended), else a turn. */
  private async deliver(text: string): Promise<void> {
    const threadId = this.threadId;
    if (!threadId) return;
    const input = codexInput(this.opts.cwd, text, this.settings.permissionMode);
    if (this.turnId) {
      const steered = await this.rpc
        .request("turn/steer", { threadId, expectedTurnId: this.turnId, input })
        .then(() => true)
        .catch(() => false);
      if (steered) return;
    }
    const policy = codexPolicy(this.settings.permissionMode);
    const r = await this.rpc.request("turn/start", {
      threadId,
      input,
      approvalPolicy: policy.approvalPolicy,
      approvalsReviewer: policy.approvalsReviewer,
      sandboxPolicy: sandboxPolicy(policy.sandbox),
      ...(this.settings.model ? { model: this.settings.model } : {}),
      effort: this.settings.effort,
    });
    const turn = str(obj(r.turn)?.id);
    if (turn && !this.ended.has(turn)) this.turnId = turn;
  }

  private onLine(line: string): void {
    let m: Json | undefined;
    try {
      m = obj(JSON.parse(line));
    } catch {
      return;
    }
    if (!m || this.rpc.settle(m)) return;
    const method = str(m.method);
    if (!method) return;
    if (m.id !== undefined) {
      void this.serverRequest(m.id, method, obj(m.params) ?? {});
      return;
    }
    const params = obj(m.params) ?? {};
    if (this.threadId && str(params.threadId) && params.threadId !== this.threadId) return;
    if (method === "turn/started") this.turnId = str(obj(params.turn)?.id);
    if (method === "turn/completed") {
      const id = str(obj(params.turn)?.id);
      if (id) this.ended.add(id);
      if (!id || id === this.turnId) this.turnId = undefined;
    }
    for (const item of this.reader.read(method, params)) this.opts.onItem(item);
  }

  /**
   * What Codex asks of the client. Command and file-change approvals, and a request for more access, become the
   * panel's approval cards; a deny is declined, and its reason (Codex's decline carries none) goes into the turn
   * word for word. An MCP server's own questions are declined (ezapply's tools are approved in the thread's config,
   * and the user's servers are off), and Codex's own question tool answers nothing: questions go on `ask_user` cards.
   */
  private async serverRequest(id: unknown, method: string, p: Json): Promise<void> {
    const approval = this.approval(method, p);
    if (approval) {
      const decision = await (this.opts.approve?.(approval) ??
        Promise.resolve({ behavior: "deny" as const, message: "Nobody can approve this here." }));
      if (method === "item/permissions/requestApproval") {
        this.rpc.respond(id, {
          permissions: decision.behavior === "allow" ? (p.permissions ?? {}) : {},
          scope: "turn",
        });
      } else {
        this.rpc.respond(id, { decision: decision.behavior === "allow" ? "accept" : "decline" });
      }
      if (decision.behavior === "deny") this.tellDenied(str(p.turnId), decision.message);
      return;
    }
    switch (method) {
      case "mcpServer/elicitation/request":
        this.rpc.respond(id, { action: "decline", content: null, _meta: null });
        return;
      case "item/tool/requestUserInput":
        this.rpc.respond(id, { answers: {} });
        return;
      default:
        this.rpc.refuse(id, `ezapply doesn't handle ${method}`);
    }
  }

  /** The card for an approval Codex asks for, or undefined for a request that isn't one. */
  private approval(method: string, p: Json): ApprovalRequest | undefined {
    const reason = str(p.reason);
    const description = reason ? { description: reason } : {};
    switch (method) {
      case "item/commandExecution/requestApproval": {
        const input = { command: commandOf(p), ...(str(p.cwd) ? { cwd: p.cwd } : {}) };
        return { toolName: "Shell", input, ...description };
      }
      case "item/fileChange/requestApproval": {
        const changes = this.reader.changes(str(p.itemId) ?? "");
        const files = changes.map((c) => c.path);
        return {
          toolName: "Patch",
          input: { file_path: files[0] ?? "", files, diff: changes.map((c) => c.diff).join("\n") },
          ...description,
        };
      }
      case "item/permissions/requestApproval":
        return { toolName: "Permissions", input: { permissions: p.permissions ?? {} }, ...description };
      default:
        return undefined;
    }
  }

  /** A deny's message into the turn that asked, as Codex's decline carries none; nothing when that turn has ended. */
  private tellDenied(turnId: string | undefined, message: string): void {
    const threadId = this.threadId;
    if (!threadId || !turnId) return;
    const clientUserMessageId = `ezapply-deny-${++this.denySeq}`;
    this.reader.ownMessage(clientUserMessageId, message);
    void this.rpc
      .request("turn/steer", {
        threadId,
        expectedTurnId: turnId,
        clientUserMessageId,
        input: [{ type: "text", text: message, text_elements: [] }],
      })
      .catch(() => undefined);
  }
}

/**
 * The app server's notifications (verified with Codex 0.163), read into what the panel shows. Only these are read:
 * - `item/started` / `item/completed` with an `item`: `userMessage` (a message taken; ezapply's own deny messages
 *   aren't the user's), `agentMessage` (`text`, once complete), and the calls: `commandExecution` (`command`,
 *   `status`, `exitCode`, `aggregatedOutput`), `fileChange` (`changes[] { path, diff }`), `mcpToolCall` (`server`,
 *   `tool`, `arguments`, `error`), `webSearch`, `collabAgentToolCall`, `dynamicToolCall`, `imageView`.
 * - `mcpServer/startupStatus/updated` (`name`, `status`: `starting`, `ready`, `failed`): whether ezapply's connected.
 * - `thread/tokenUsage/updated` (`tokenUsage.total.totalTokens`, the thread's so far): Codex reports no cost.
 * - `error` (`willRetry`), `turn/started`, `turn/completed` (`turn { status, error, durationMs }`).
 * Reasoning, deltas, rate limits and the rest are skipped.
 */
export class CodexReader {
  private tokens: number | undefined;
  private turnStart: number | undefined;
  private mcp: string | undefined;
  private threadId: string | undefined;
  private watchMcp = false;
  private mcpReported = false;
  private readonly fileChanges = new Map<string, { path: string; diff: string }[]>();
  private readonly own = new Map<string, string>();

  constructor(
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly clock: () => number = Date.now,
  ) {}

  /** The thread is ready: its id, and whether ezapply's server is configured (its state follows when it's up). */
  started(threadId: string, configured: boolean): StreamItem[] {
    this.threadId = threadId;
    this.watchMcp = configured;
    const items: StreamItem[] = [
      { type: "agentSession", id: threadId },
      // Without ezapply's server there's nothing to wait for: say so now.
      configured ? { type: "init", sessionId: threadId } : { type: "init", sessionId: threadId, mcpServers: [] },
    ];
    return [...items, ...this.mcpState()];
  }

  /** A message ezapply sent into the turn itself (a deny's reason): its taking isn't a user message's. */
  ownMessage(clientId: string, text: string): void {
    this.own.set(clientId, text);
  }

  /** A file change's files, from its `item/started`, for its approval card. */
  changes(itemId: string): { path: string; diff: string }[] {
    return this.fileChanges.get(itemId) ?? [];
  }

  read(method: string, p: Json): StreamItem[] {
    const at = this.now();
    switch (method) {
      case "mcpServer/startupStatus/updated":
        if (str(p.name) === "ezapply") this.mcp = str(p.status);
        return this.mcpState();
      case "thread/tokenUsage/updated":
        this.tokens = num(obj(obj(p.tokenUsage)?.total)?.totalTokens) ?? this.tokens;
        return [];
      case "turn/started":
        this.turnStart = this.clock();
        return [];
      case "error": {
        if (p.willRetry !== true) return [];
        const why = str(obj(p.error)?.message) ?? "unknown";
        return [notice("warn", `The API failed (${why}); retrying.`, at)];
      }
      case "item/started":
        return this.itemStarted(obj(p.item) ?? {}, at);
      case "item/completed":
        return this.itemCompleted(obj(p.item) ?? {}, at);
      case "turn/completed": {
        const turn = obj(p.turn) ?? {};
        const status = str(turn.status);
        const took = this.turnStart !== undefined ? this.clock() - this.turnStart : undefined;
        this.turnStart = undefined;
        const duration = num(turn.durationMs) ?? took;
        const interrupted = status === "interrupted";
        const ok = status === "completed";
        const error = !ok && !interrupted ? (str(obj(turn.error)?.message) ?? status ?? "failed") : undefined;
        return [
          {
            type: "turnEnd",
            queued: 0,
            event: {
              kind: "turnEnd",
              at,
              ok,
              ...(interrupted ? { interrupted: true } : {}),
              ...(this.tokens !== undefined ? { totalTokens: this.tokens } : {}),
              ...(duration !== undefined ? { durationMs: duration } : {}),
              ...(error ? { error: error.slice(0, 500) } : {}),
            },
          },
        ];
      }
      default:
        return [];
    }
  }

  /** Once the thread is ready and ezapply's server has come up or failed: its state, as Claude Code's `init` gives it. */
  private mcpState(): StreamItem[] {
    if (!this.threadId || !this.watchMcp || this.mcpReported) return [];
    if (this.mcp !== "ready" && this.mcp !== "failed" && this.mcp !== "cancelled") return [];
    this.mcpReported = true;
    const status = this.mcp === "ready" ? "connected" : this.mcp;
    return [{ type: "init", sessionId: this.threadId, mcpServers: [{ name: "ezapply", status }] }];
  }

  private itemStarted(item: Json, at: string): StreamItem[] {
    const id = str(item.id) ?? "";
    switch (str(item.type)) {
      case "userMessage": {
        // By its id, or by its words should the id not come back.
        const text = textOf(item.content);
        const own = [...this.own].find(([clientId, t]) => clientId === str(item.clientId) || t === text)?.[0];
        if (own) {
          this.own.delete(own);
          return [];
        }
        return [{ type: "taken", text }];
      }
      case "fileChange":
        this.fileChanges.set(id, changesOf(item));
        return [
          toolEvent(
            at,
            id,
            "Patch",
            changesOf(item)
              .map((c) => c.path)
              .join(", "),
          ),
        ];
      default: {
        const call = describe(item);
        return call ? [toolEvent(at, id, call.name, call.summary)] : [];
      }
    }
  }

  private itemCompleted(item: Json, at: string): StreamItem[] {
    const id = str(item.id) ?? "";
    const type = str(item.type);
    if (type === "agentMessage") {
      const text = str(item.text)?.trim();
      return text ? [{ type: "event", event: { kind: "text", at, text } }] : [];
    }
    if (type === "fileChange") this.fileChanges.delete(id);
    if (type !== "fileChange" && !describe(item)) return [];
    const status = str(item.status);
    const exit = num(item.exitCode);
    const ok = status === "completed" && (exit === undefined || exit === 0) && item.success !== false;
    const error = ok ? undefined : failure(item, status);
    return [{ type: "event", event: { kind: "toolDone", at, id, ok, ...(error ? { error } : {}) } }];
  }
}

/** A call item as the panel names it: ezapply's MCP tools as Claude Code names them, so `toolSummary` folds them alike. */
function describe(item: Json): { name: string; summary: string } | undefined {
  switch (str(item.type)) {
    case "commandExecution":
      return { name: "Shell", summary: clip(commandOf(item), 200) };
    case "mcpToolCall": {
      const server = str(item.server) ?? "mcp";
      const tool = str(item.tool) ?? "tool";
      const name = `mcp__${server}__${tool}`;
      return { name: server === "ezapply" ? name : `${server}/${tool}`, summary: toolSummary(name, item.arguments) };
    }
    case "webSearch":
      return { name: "WebSearch", summary: clip(str(item.query) ?? "", 120) };
    case "collabAgentToolCall":
      return { name: "Agent", summary: clip(str(item.prompt) ?? str(item.tool) ?? "", 120) };
    case "dynamicToolCall":
      return { name: str(item.tool) ?? "tool", summary: clip(JSON.stringify(item.arguments ?? {}), 160) };
    case "imageView":
      return { name: "ViewImage", summary: str(item.path) ?? "" };
    default:
      return undefined;
  }
}

/** The command a person reads: the parsed command when Codex gives it, not the shell wrapped around it. */
function commandOf(item: Json): string {
  const actions = Array.isArray(item.commandActions) ? item.commandActions : [];
  const parsed = actions
    .map((a) => str(obj(a)?.command))
    .filter(Boolean)
    .join(" && ");
  return parsed || str(item.command) || "";
}

function changesOf(item: Json): { path: string; diff: string }[] {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  return changes.flatMap((c) => {
    const o = obj(c);
    const path = str(o?.path);
    return path ? [{ path, diff: str(o?.diff) ?? "" }] : [];
  });
}

function failure(item: Json, status: string | undefined): string | undefined {
  if (status === "declined") return "Declined";
  const message = str(obj(item.error)?.message);
  if (message) return clip(message, 300);
  const exit = num(item.exitCode);
  const output = str(item.aggregatedOutput)?.trim();
  if (exit !== undefined) return clip(`exit code ${exit}${output ? `: ${output.slice(-300)}` : ""}`, 300);
  return status;
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (obj(c)?.type === "text" ? (str(obj(c)?.text) ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

function toolEvent(at: string, id: string, name: string, summary: string): StreamItem {
  return { type: "event", event: { kind: "tool", at, id, name, summary } };
}

function notice(level: "info" | "warn" | "error", text: string, at = new Date().toISOString()): StreamItem {
  const event: AgentEvent = { kind: "notice", at, level, text };
  return { type: "event", event };
}

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

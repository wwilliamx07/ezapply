import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join, win32 } from "node:path";
import { createInterface } from "node:readline";
import {
  type AgentModel,
  type AgentPermissionMode,
  type AgentSettings,
  type ConversationPart,
  DEFAULT_AGENT_SETTINGS,
} from "@ezapply/protocol";
import { which } from "../util/proc.js";
import { readStreamLine, type StreamItem } from "./stream.js";

/** How to run Claude Code: the native `claude.exe`, or the npm install's `claude.cmd` (only runs through cmd). */
export interface ClaudeCommand {
  file: string;
  /** Arguments that always come first (tests run a stub script through node). */
  args: string[];
  /** A .cmd/.bat launcher on Windows. */
  shell: boolean;
}

/** Claude Code on PATH (or EZAPPLY_CLAUDE): the native `claude.exe`, or the npm install's `claude.cmd` on Windows. */
export function findClaude(env: NodeJS.ProcessEnv = process.env, platform = process.platform): ClaudeCommand | null {
  const isScript = (p: string) => platform === "win32" && /.(cmd|bat)$/i.test(p);
  if (env.EZAPPLY_CLAUDE) return { file: env.EZAPPLY_CLAUDE, args: [], shell: isScript(env.EZAPPLY_CLAUDE) };
  const names = platform === "win32" ? ["claude.exe", "claude.cmd", "claude.bat"] : ["claude"];
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const file = join(dir, name);
      if (existsSync(file)) return { file, args: [], shell: isScript(file) };
    }
  }
  return null;
}

/** The environment variable the MCP relay passes on as `SESSION_HEADER`, naming the conversation's session. */
export const SESSION_ENV = "EZAPPLY_SESSION";
/** The header the MCP relay names the conversation's session in. */
export const SESSION_HEADER = "x-ezapply-session";

const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;

/** The session id from a request header, or undefined when it's missing or malformed. */
export function sessionId(header: string | string[] | undefined): string | undefined {
  const id = Array.isArray(header) ? header[0] : header;
  return id && SESSION_ID.test(id) ? id : undefined;
}

/** The permission prompt tool Claude Code asks instead of a terminal dialog (served by `mcp/tools/agent.ts`). */
export const PERMISSION_TOOL = "mcp__ezapply__permission_ask";

export interface AgentProcessOptions {
  claude: ClaudeCommand;
  cwd: string;
  sessionId: string;
  /** Continue an existing session rather than start one with this id. */
  resume: boolean;
  /** The permission mode, model and effort it starts with (the panel's settings). */
  settings?: AgentSettings;
  /** A posting's conversation: which part, for its line of the system prompt (`PART_PROMPTS`). */
  part?: ConversationPart;
  env?: NodeJS.ProcessEnv;
  onItem: (item: StreamItem) => void;
  onExit: (code: number | null, stderrTail: string) => void;
}

/**
 * The arguments of a conversation's Claude Code process. Why each:
 * - `-p` with stream-json both ways: messages arrive on stdin as JSON lines and the process stays up between
 *   turns while stdin is open, so a conversation is one process; `--verbose` is required for stream-json output.
 * - `--replay-user-messages`: each message is echoed when Claude takes it, so the panel can mark it taken (a
 *   message sent while a tool runs waits for the tool to end).
 * - `--permission-mode`, `--model` and `--effort` from the panel's settings, always, so the user's own Claude Code
 *   defaults don't decide them behind the panel.
 * - `--permission-prompt-tool`: what would prompt in the terminal asks the panel instead.
 * - `--append-system-prompt`: `PANEL_PROMPT`, and for a posting's conversation its part's line (`PART_PROMPTS`).
 * - The user's own Claude Code setup stays out (`PANEL_SCOPE`): it was half of every call's starting context.
 * - Not `--bare`: bare mode skips the workspace's skills, `.mcp.json` and settings, and the subscription login.
 */
export function agentArgs(
  sessionId: string,
  resume: boolean,
  settings: AgentSettings = DEFAULT_AGENT_SETTINGS,
  part?: ConversationPart,
  shell: PanelShell = "Bash",
): string[] {
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--replay-user-messages",
    "--permission-mode",
    settings.permissionMode,
    "--model",
    settings.model,
    "--effort",
    settings.effort,
    "--permission-prompt-tool",
    PERMISSION_TOOL,
    ...PANEL_SCOPE,
    "--tools",
    [shell, ...PANEL_TOOLS].join(","),
    "--append-system-prompt",
    part ? `${PANEL_PROMPT} ${PART_PROMPTS[part]}` : PANEL_PROMPT,
    ...(resume ? ["--resume", sessionId] : ["--session-id", sessionId]),
  ];
}

/**
 * What the panel's Claude Code loads beyond the workspace: nothing. The user's own MCP servers (claude.ai connectors
 * among them), plugins and user-level skills cost tokens on every call, and a document skill of theirs that claims
 * resumes and cover letters competes with ezapply's. Only `.mcp.json`'s servers, and the project and local settings
 * (the workspace's permission rules, and the approvals the user saved there); the subscription login isn't a setting
 * and still applies. Bundled skills go too (`DISABLE_BUNDLED_SKILLS`, an environment variable).
 */
const PANEL_SCOPE = ["--strict-mcp-config", "--mcp-config", ".mcp.json", "--setting-sources", "project,local"];

/** Claude Code's switch for its bundled skills, set on the panel's process. */
export const DISABLE_BUNDLED_SKILLS = "CLAUDE_CODE_DISABLE_BUNDLED_SKILLS";

/**
 * The built-in tools the panel's work uses, beside one shell (`panelShell`); the rest are schemas re-read on every
 * call. AskUserQuestion isn't among them: questions go through `ask_user`, which holds a whole step's questions and
 * text answers. Agent stays for repo indexing and other large reading jobs.
 */
export const PANEL_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Skill", "ToolSearch", "Agent"];

export type PanelShell = "Bash" | "PowerShell";

/**
 * One shell, not both: each is a large schema. Bash where Claude Code can run it, since the workspace's rules are
 * written for it (no `python` for edits); on Windows that needs Git Bash, and without it PowerShell.
 */
export function panelShell(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  find: (bin: string) => string | null = which,
  exists: (path: string) => boolean = existsSync,
): PanelShell {
  if (platform !== "win32") return "Bash";
  if (env.CLAUDE_CODE_GIT_BASH_PATH && exists(env.CLAUDE_CODE_GIT_BASH_PATH)) return "Bash";
  const git = find("git");
  // Git for Windows puts git.exe in cmd\ (or bin\), and bash.exe in bin\ beside it.
  return git && exists(win32.join(win32.dirname(win32.dirname(git)), "bin", "bash.exe")) ? "Bash" : "PowerShell";
}

/**
 * Appended to Claude Code's system prompt: where its words go. The skills already say what to do; this says that
 * the user reads it in a narrow panel and answers questions on cards there, and that no terminal is watched.
 */
export const PANEL_PROMPT =
  "You are running headless behind ezapply's side panel in the user's browser: the user reads your messages there " +
  "and never sees a terminal. Put questions you need answered on a card with ask_user (a whole step's questions in " +
  "one call); a plain question in your message is fine when an open-ended reply is wanted, since the user can answer " +
  "in the panel's chat. Commands that need approval are approved on the panel. Keep messages short: the panel is " +
  "narrow.";

/**
 * A posting's two conversations, one for its documents and one for its application, whichever the user starts
 * first: each line keeps its conversation to its part, and sends the user to the other for the rest.
 */
export const PART_PROMPTS: Record<ConversationPart, string> = {
  tailor:
    "This conversation prepares the active posting's documents (resume, cover letter, bundle) and their review. " +
    "Its application is filled in a separate conversation: don't fill, read or navigate application forms here. " +
    "When the user wants the application filled, tell them to press Fill form in the panel.",
  fill:
    "This conversation fills the active posting's application. Its documents are written in a separate " +
    "conversation: don't write or edit a resume, cover letter or bundle here; you may show the ones already there " +
    "for review and attach them. When a document is missing, or the user asks for changes to one, tell them to " +
    "press Tailor documents in the panel (with their changes, if they asked for any), and fill the rest of the " +
    "form meanwhile.",
};

/** One conversation's Claude Code process: messages in, stream items out. */
export class AgentProcess {
  private readonly child: ChildProcess;
  private stderrTail = "";
  private exited = false;
  private controlSeq = 0;

  constructor(private readonly opts: AgentProcessOptions) {
    const { file, shell } = opts.claude;
    const base = opts.env ?? process.env;
    const args = [
      ...opts.claude.args,
      ...agentArgs(opts.sessionId, opts.resume, opts.settings, opts.part, panelShell(base)),
    ];
    const env: NodeJS.ProcessEnv = { ...base, [SESSION_ENV]: opts.sessionId, [DISABLE_BUNDLED_SKILLS]: "1" };
    // A long MCP call (ask_user, a review) must hold the turn, which is -p's default; the user's own setting
    // to background such calls would end the turn with the question open.
    delete env.CLAUDE_AUTO_BACKGROUND_TASKS;
    this.child = spawn(shell ? quoteForCmd(file) : file, shell ? args.map(quoteForCmd) : args, {
      cwd: opts.cwd,
      env,
      shell,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    createInterface({ input: this.child.stdout as NodeJS.ReadableStream }).on("line", (line) => {
      for (const item of readStreamLine(line)) opts.onItem(item);
    });
    this.child.stderr?.on("data", (d: Buffer) => {
      this.stderrTail = (this.stderrTail + d.toString("utf8")).slice(-2000);
    });
    this.child.stdin?.on("error", () => {
      // The process went away; its exit is reported below.
    });
    this.child.on("error", (err) => this.exit(null, `${this.stderrTail}\n${err.message}`));
    this.child.on("exit", (code) => this.exit(code, this.stderrTail));
  }

  get alive(): boolean {
    return !this.exited;
  }

  /** A user message, as a JSON line. Claude takes it now, or at the next tool call's end while a turn runs. */
  send(text: string): void {
    this.write({ type: "user", message: { role: "user", content: text } });
  }

  /** End the running turn (a running tool call's result is dropped). Returns the request's id. */
  interrupt(): string {
    const id = `interrupt-${++this.controlSeq}`;
    this.write({ type: "control_request", request_id: id, request: { subtype: "interrupt" } });
    return id;
  }

  /** Switch the permission mode mid-session (Claude Code's `set_permission_mode`). Returns the request's id. */
  setPermissionMode(mode: AgentPermissionMode): string {
    const id = `mode-${++this.controlSeq}`;
    this.write({ type: "control_request", request_id: id, request: { subtype: "set_permission_mode", mode } });
    return id;
  }

  /** Switch the model mid-session (`set_model`). Returns the request's id. */
  setModel(model: AgentModel): string {
    const id = `model-${++this.controlSeq}`;
    this.write({ type: "control_request", request_id: id, request: { subtype: "set_model", model } });
    return id;
  }

  /** Close stdin, which ends the process once it's idle; kill it if it hasn't exited after `graceMs`. */
  close(graceMs = 10_000): Promise<void> {
    if (this.exited) return Promise.resolve();
    const done = new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
    this.child.stdin?.end();
    const timer = setTimeout(() => this.kill(), graceMs);
    timer.unref();
    return done.finally(() => clearTimeout(timer));
  }

  /** The whole tree: Claude and what it started (its MCP relay, a running command). */
  kill(): void {
    if (this.exited) return;
    if (process.platform === "win32" && this.child.pid) {
      spawnSync("taskkill", ["/pid", String(this.child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      this.child.kill("SIGTERM");
      setTimeout(() => {
        if (!this.exited) this.child.kill("SIGKILL");
      }, 5000).unref();
    }
  }

  private write(o: unknown): void {
    if (this.exited || !this.child.stdin?.writable) return;
    this.child.stdin.write(`${JSON.stringify(o)}\n`);
  }

  private exit(code: number | null, tail: string): void {
    if (this.exited) return;
    this.exited = true;
    this.opts.onExit(code, tail.trim());
  }
}

/** cmd.exe quoting for the shell launch of a .cmd file. */
function quoteForCmd(s: string): string {
  return /^[\w\-./:\\=@]+$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`;
}

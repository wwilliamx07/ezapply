import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
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

/** The environment variable the MCP relay passes on as `x-ezapply-chat-session`, naming the conversation's session. */
export const SESSION_ENV = "EZAPPLY_CHAT_SESSION";

/** The permission prompt tool Claude Code asks instead of a terminal dialog (served by `mcp/tools/agent.ts`). */
export const PERMISSION_TOOL = "mcp__ezapply__permission_ask";

export interface AgentProcessOptions {
  claude: ClaudeCommand;
  cwd: string;
  sessionId: string;
  /** Continue an existing session rather than start one with this id. */
  resume: boolean;
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
 * - `--permission-mode default`: without it a `-p` run may start in auto mode, and nothing would reach the panel.
 * - `--permission-prompt-tool`: what would prompt in the terminal asks the panel instead.
 * - `--disallowedTools AskUserQuestion`: questions go through `ask_user`, which holds a whole step's questions
 *   and text answers; Claude Code's own tool holds four questions of four options.
 * - Not `--bare`: bare mode skips the workspace's skills, `.mcp.json` and settings, and the subscription login.
 */
export function agentArgs(sessionId: string, resume: boolean): string[] {
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--replay-user-messages",
    "--permission-mode",
    "default",
    "--permission-prompt-tool",
    PERMISSION_TOOL,
    "--disallowedTools",
    "AskUserQuestion",
    "--append-system-prompt",
    PANEL_PROMPT,
    ...(resume ? ["--resume", sessionId] : ["--session-id", sessionId]),
  ];
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

/** One conversation's Claude Code process: messages in, stream items out. */
export class AgentProcess {
  private readonly child: ChildProcess;
  private stderrTail = "";
  private exited = false;
  private controlSeq = 0;

  constructor(private readonly opts: AgentProcessOptions) {
    const { file, shell } = opts.claude;
    const args = [...opts.claude.args, ...agentArgs(opts.sessionId, opts.resume)];
    const env: NodeJS.ProcessEnv = { ...(opts.env ?? process.env), [SESSION_ENV]: opts.sessionId };
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

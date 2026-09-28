import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { CHAT_PATH, type DaemonConfig } from "@ezapply/companion";
import { control } from "./daemonctl.js";

/** Set for Claude and everything it starts; the MCP relay passes it to the daemon as a header. */
export const CHAT_SESSION_ENV = "EZAPPLY_CHAT_SESSION";

/** What the daemon reports about a chat session (GET /control/chat). */
export interface ChatState {
  activePosting: { id: string; company?: string; role?: string } | null;
  used: boolean;
  inFlight: number;
  restartOnCapture: boolean;
}

export interface ClaudeCommand {
  file: string;
  /** Arguments that always come first (tests run a stub script through node). */
  args: string[];
  /** A .cmd/.bat launcher on Windows, which only runs through the shell. */
  shell: boolean;
}

/** Claude Code on PATH (or EZAPPLY_CLAUDE): the native `claude.exe`, or the npm install's `claude.cmd` on Windows. */
export function findClaude(env: NodeJS.ProcessEnv = process.env, platform = process.platform): ClaudeCommand | null {
  const isScript = (p: string) => platform === "win32" && /\.(cmd|bat)$/i.test(p);
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

export const fetchChatState = (config: DaemonConfig, session: string) =>
  control<ChatState>(config, `${CHAT_PATH}?session=${encodeURIComponent(session)}`, "GET");

export interface ChatOptions {
  claude: ClaudeCommand;
  /** Passed to the first `claude` only: a restart starts a plain new session. */
  args: string[];
  cwd: string;
  state: (session: string) => Promise<ChatState | null>;
  pollMs?: number;
  /** Where to tell the user about a restart. */
  say?: (line: string) => void;
  newSession?: () => string;
  resetTerminal?: () => void;
  env?: NodeJS.ProcessEnv;
  stdio?: "inherit" | "ignore";
}

/**
 * Run Claude Code in the workspace, and start it afresh when the user captures a different posting.
 *
 * Every turn re-sends the whole conversation, so a session that carries a finished application (or the
 * onboarding) into the next one pays for it on every turn: measured, about half the tokens of a fill.
 * Claude can't clear its own context and Claude Code hooks can't trigger /clear, so the wrapper restarts
 * the process. Nothing needs handing over: a posting's work finishes in one session, what carries over is on
 * disk, and the new session's relay attaches to the same daemon, which the extension stays connected to.
 *
 * The restart happens only when the session has used a tool (an untouched session has nothing to drop) and
 * no tool call is running (a fill or a build is never cut in half). Claude's own text between calls can be
 * cut off; capturing the next posting is a deliberate act, and `claude --resume` reopens the old session.
 */
export async function runChat(opts: ChatOptions): Promise<number> {
  const say = opts.say ?? ((line: string) => process.stdout.write(line));
  let args = opts.args;
  for (;;) {
    const session = (opts.newSession ?? randomUUID)();
    const child = startClaude(opts, args, session);
    const exited = new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });

    // undefined until the daemon first answers: the posting active then is this session's own.
    let baseline: string | null | undefined;
    let next: ChatState["activePosting"] = null;
    let polling = false;
    const poll = async () => {
      const s = await opts.state(session).catch(() => null);
      if (!s || next) return;
      const posting = s.activePosting?.id ?? null;
      if (baseline === undefined || posting === null || posting === baseline) {
        baseline ??= posting;
        return;
      }
      if (!s.used || !s.restartOnCapture) {
        baseline = posting; // nothing to drop, or turned off: this posting is the session's now
        return;
      }
      if (s.inFlight > 0) return;
      next = s.activePosting;
      stopClaude(child);
    };
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void poll().finally(() => {
        polling = false;
      });
    }, opts.pollMs ?? 1000);

    const code = await exited.finally(() => clearInterval(timer));
    if (!next) return code;
    (opts.resetTerminal ?? resetTerminal)();
    say(
      `\nezapply: new posting (${postingLabel(next)}). Started a fresh Claude session; ` +
        "the last one can be reopened with `claude --resume`.\n\n",
    );
    args = [];
  }
}

function startClaude(opts: ChatOptions, args: string[], session: string): ChildProcess {
  const { file, shell } = opts.claude;
  const all = [...opts.claude.args, ...args];
  return spawn(shell ? quoteForCmd(file) : file, shell ? all.map(quoteForCmd) : all, {
    cwd: opts.cwd,
    stdio: opts.stdio ?? "inherit",
    shell,
    env: { ...(opts.env ?? process.env), [CHAT_SESSION_ENV]: session },
  });
}

/** Windows: the whole tree (claude and what it started, such as the relay); elsewhere a TERM, then a KILL. */
function stopClaude(child: ChildProcess): void {
  if (process.platform === "win32") {
    if (child.pid)
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else child.kill();
    return;
  }
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 5000).unref();
}

/**
 * A killed Claude may leave the terminal as its UI set it (raw input, hidden cursor, paste and mouse
 * reporting). Put it back before the next one starts. The alternate screen isn't touched: Claude Code
 * doesn't use it, and leaving it when not in it moves the cursor.
 */
export function resetTerminal(): void {
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {
      // not a console we can change
    }
    process.stdin.pause();
  }
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[0m\x1b[?25h\x1b[?2004l\x1b[?1004l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l");
  }
}

function postingLabel(p: NonNullable<ChatState["activePosting"]>): string {
  return [p.company, p.role].filter(Boolean).join(": ") || p.id;
}

/** cmd.exe quoting for the shell launch of a .cmd file. */
function quoteForCmd(s: string): string {
  return /^[\w\-./:\\=@]+$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`;
}

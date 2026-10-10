import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  type AppConfig,
  type ChatHost,
  type ClaudeCommand,
  type CompanionHandle,
  createLogger,
  findClaude,
  HEALTH_MODE,
  type Logger,
  type PostingRef,
  startCompanion,
  waitFor,
} from "@ezapply/companion";
import { fetchHealth } from "./health.js";

/** Set for Claude and everything it starts; the MCP relay passes it to the companion as a header. */
export const CHAT_SESSION_ENV = "EZAPPLY_CHAT_SESSION";

export { type ClaudeCommand, findClaude };

export interface HostChatOptions {
  config: AppConfig;
  claude: ClaudeCommand;
  /** Passed to the first `claude` only. */
  args: string[];
  /** The extension package folder, so extension_pair can say what to load. */
  extensionDir?: string;
  log?: Logger;
  /** Where a failure to start is reported (before Claude owns the terminal). */
  fail?: (line: string) => void;
  /** Called once the companion listens, before Claude starts. */
  onStarted?: (handle: CompanionHandle) => void;
  /** Test hooks for runChat. */
  chat?: Pick<ChatOptions, "say" | "newSession" | "resetTerminal" | "env" | "stdio">;
  /** Test hooks for the companion. */
  companion?: { appDataDir?: string; saveConfig?: (config: AppConfig) => Promise<void> };
}

/**
 * `ezapply chat`: start the companion (MCP server and extension bridge) in this process, run Claude Code in
 * the workspace as a child, and close the companion when Claude exits. There is no background process: the
 * tools and the extension connection exist exactly while a chat is open. If the companion can't start,
 * Claude isn't started either (it would have no tools).
 */
export async function hostChat(opts: HostChatOptions): Promise<number> {
  const log = opts.log ?? createLogger();
  const fail = opts.fail ?? ((line: string) => process.stderr.write(`${line}\n`));
  const started = await startHosted(opts, log);
  if (typeof started === "string") {
    fail(started);
    return 1;
  }
  const handle = started;
  // After listen, a server error doesn't reach anyone; log it. The relay then tells Claude ezapply is down.
  handle.onServerError((err) => log.error({ err: err.message }, "chat: companion server error"));
  opts.onStarted?.(handle);
  try {
    return await runChat({
      ...opts.chat,
      claude: opts.claude,
      args: opts.args,
      cwd: opts.config.workspace,
      host: handle.chat,
    });
  } finally {
    await handle.close();
  }
}

/** The started companion, or what to tell the user when the port is taken. */
async function startHosted(opts: HostChatOptions, log: Logger): Promise<CompanionHandle | string> {
  const { config } = opts;
  const start = async () => {
    try {
      return await startCompanion({
        config,
        log,
        ...(opts.extensionDir ? { extensionDir: opts.extensionDir } : {}),
        ...(opts.companion?.appDataDir ? { appDataDir: opts.companion.appDataDir } : {}),
        ...(opts.companion?.saveConfig ? { saveConfig: opts.companion.saveConfig } : {}),
      });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") return null;
      throw err;
    }
  };
  const first = await start();
  if (first) return first;

  const health = await fetchHealth(config);
  if (health?.mode === HEALTH_MODE) {
    return `ezapply is already running in another terminal (port ${config.port}). Use that one, or exit it first.`;
  }
  if (health && (await stopLegacyDaemon(config))) {
    log.info("chat: stopped a background daemon from an earlier build");
    const second = await start();
    if (second) return second;
  }
  return (
    `Port ${config.port} is in use by another program. Close it, or move ezapply to a free port: ` +
    "`ezapply init --port <n>`, then enter the same port in the extension's options."
  );
}

/**
 * Builds before this one ran the companion as a background daemon, which may still be up after an update.
 * It answers POST /control/shutdown (with the MCP token) and exits. Returns whether the port came free.
 */
async function stopLegacyDaemon(config: AppConfig): Promise<boolean> {
  await fetch(`http://${config.host}:${config.port}/control/shutdown`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.mcpToken}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(5000),
  }).catch(() => undefined);
  return Boolean(await waitFor(async () => ((await fetchHealth(config)) ? null : true), 10_000));
}

export interface ChatOptions {
  claude: ClaudeCommand;
  /** Passed to the first `claude` only: a restart starts a plain new session. */
  args: string[];
  cwd: string;
  host: ChatHost;
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
 * disk, and the new session's relay attaches to the same companion, which the extension stays connected to.
 *
 * The restart happens only when the session has used a tool (an untouched session has nothing to drop) and
 * no tool call is running (a fill or a build is never cut in half). The companion reports a change of the
 * active posting and the end of every tool call, and the rules are checked again on each, so a restart
 * happens as soon as they allow it. Claude's own text between calls can be cut off; capturing the next
 * posting is a deliberate act, and `claude --resume` reopens the old session.
 */
export async function runChat(opts: ChatOptions): Promise<number> {
  const say = opts.say ?? ((line: string) => process.stdout.write(line));
  const { host } = opts;
  let args = opts.args;
  for (;;) {
    const session = (opts.newSession ?? randomUUID)();
    // The posting active now is this session's own.
    let baseline = (await host.activePosting().catch(() => null))?.id ?? null;
    let next: PostingRef | null = null;
    const child = startClaude(opts, args, session);
    const exited = new Promise<number>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });

    let checking = false;
    let again = false;
    const check = async () => {
      if (checking) {
        again = true; // a change during a check is looked at once the check ends
        return;
      }
      checking = true;
      try {
        do {
          again = false;
          if (next) return;
          const posting = await host.activePosting();
          if (!posting || posting.id === baseline) continue;
          const s = host.session(session);
          if (!s.used || !(await host.restartOnCapture())) {
            baseline = posting.id; // nothing to drop, or turned off: this posting is the session's now
            continue;
          }
          if (s.inFlight > 0) continue; // checked again when the call ends
          next = posting;
          stopClaude(child);
        } while (again);
      } finally {
        checking = false;
      }
    };
    const unsubscribe = host.onChange(() => {
      check().catch(() => {});
    });

    const code = await exited.finally(unsubscribe);
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

function postingLabel(p: PostingRef): string {
  return [p.company, p.role].filter(Boolean).join(": ") || p.id;
}

/** cmd.exe quoting for the shell launch of a .cmd file. */
function quoteForCmd(s: string): string {
  return /^[\w\-./:\\=@]+$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`;
}

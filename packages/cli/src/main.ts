#!/usr/bin/env node
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  CHAT_SESSION_HEADER,
  COMPANION_VERSION,
  createLogger,
  type DaemonConfig,
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  DEFAULT_PORT,
  daemonConfigPath,
  loadDaemonConfig,
  MCP_PATH,
  newPairingToken,
  newToken,
  saveDaemonConfig,
  startCompanion,
  waitFor,
} from "@ezapply/companion";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { CHAT_SESSION_ENV, fetchChatState, findClaude, runChat } from "./chat.js";
import { ensureDaemon, fetchHealth, openPairing, pairingStatus, stopDaemon } from "./daemonctl.js";
import { runDoctor } from "./doctor.js";
import { runMcpRelay } from "./mcp-relay.js";
import { type InitReport, initWorkspace } from "./workspace-init.js";

const CLI_MAIN = fileURLToPath(import.meta.url);
const EXTENSION_DIR = resolve(dirname(CLI_MAIN), "..", "..", "extension");
const PAIR_WAIT_SECONDS = 10 * 60;

const USAGE = `ezapply ${COMPANION_VERSION}

Usage:
  ezapply chat [claude args…]                        Run Claude Code in the workspace (how you use ezapply);
                                                     a newly captured posting starts a fresh session
  ezapply init [--workspace <dir>] [--port <n>]      Create or refresh the workspace and local config
  ezapply start | stop | restart                     Run the daemon in the background / stop it / restart it
  ezapply daemon                                     Run the daemon in the foreground (for debugging)
  ezapply pair [--reset]                             Pair the browser extension (--reset: forget the paired one)
  ezapply status                                     Check whether the daemon is running
  ezapply doctor                                     Diagnose the whole setup
  ezapply mcp                                        MCP server on stdio (Claude Code runs this)
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "chat":
      return cmdChat(rest);
    case "init":
      return cmdInit(rest);
    case "start":
      return cmdStart(false);
    case "restart":
      return cmdStart(true);
    case "stop":
      return cmdStop();
    case "daemon":
      return cmdDaemon();
    case "pair":
      return cmdPair(rest);
    case "status":
      return cmdStatus();
    case "doctor":
      return runDoctor();
    case "mcp":
      return cmdMcp();
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(USAGE);
      return 0;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      return 2;
  }
}

/** Write ~/.ezapply/daemon.json (keeping tokens and pairing) and create or refresh the workspace. */
async function initConfig(opts: { workspace?: string; port?: string }): Promise<{
  config: DaemonConfig;
  report: InitReport;
}> {
  const existing = await loadDaemonConfig();
  const config: DaemonConfig = {
    schemaVersion: 1,
    host: "127.0.0.1",
    port: opts.port ? parsePort(opts.port) : (existing?.port ?? DEFAULT_PORT),
    mcpToken: existing?.mcpToken ?? newToken(),
    pairingToken: existing?.pairingToken ?? newPairingToken(),
    ...(existing?.pairedExtensionId ? { pairedExtensionId: existing.pairedExtensionId } : {}),
    ...(existing?.idleTimeoutMinutes !== undefined ? { idleTimeoutMinutes: existing.idleTimeoutMinutes } : {}),
    workspace: resolve(opts.workspace ?? existing?.workspace ?? join(homedir(), "ezapply-home")),
  };
  await saveDaemonConfig(config);
  return { config, report: await initWorkspace(config) };
}

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || port < 1 || port > 65535) {
    throw new EzError(ErrorCode.BadRequest, `--port must be a whole number from 1 to 65535, not "${raw}".`);
  }
  return port;
}

async function cmdInit(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { workspace: { type: "string" }, port: { type: "string" } } });
  const { config, report } = await initConfig(values);
  const out = [
    `Workspace: ${config.workspace}`,
    ...report.created.map((p) => `  created  ${p}`),
    ...report.updated.map((p) => `  updated  ${p}`),
    ...report.kept.map((p) => `  kept     ${p}`),
    "",
    `Config:    ${daemonConfigPath()}`,
    "",
    "Next:",
    `  cd "${config.workspace}"`,
    `  ${process.platform === "win32" ? ".\\ezapply" : "./ezapply"} chat`,
    'Then say "set me up". Claude checks what\'s missing (TeX, the browser extension, GitHub, your resume)',
    "and walks you through it. Always start ezapply this way: capturing another posting then starts a",
    "fresh Claude session by itself. If the daemon was running an older build: ezapply restart",
    "",
  ];
  process.stdout.write(out.join("\n"));
  return 0;
}

async function cmdStart(restart: boolean): Promise<number> {
  const config = await requireConfig();
  const { started, health } = await ensureDaemon(config, { cliMain: CLI_MAIN, restart });
  process.stdout.write(
    started
      ? `Daemon v${health.version} ${restart ? "restarted" : "started"} in the background on port ${config.port}.\n`
      : `Daemon v${health.version} is already running on port ${config.port}.\n`,
  );
  return 0;
}

async function cmdStop(): Promise<number> {
  const config = await requireConfig();
  process.stdout.write((await stopDaemon(config)) ? "Daemon stopped.\n" : "Daemon was not running.\n");
  return 0;
}

async function cmdDaemon(): Promise<number> {
  const config = await requireConfig();
  const log = createLogger();
  let handle: Awaited<ReturnType<typeof startCompanion>> | undefined;
  const shutdown = async () => {
    log.info("shutting down");
    await handle?.close();
    process.exit(0);
  };
  try {
    handle = await startCompanion({
      config,
      log,
      extensionDir: EXTENSION_DIR,
      onShutdownRequest: () => void shutdown(),
      idleTimeoutMs: (config.idleTimeoutMinutes ?? DEFAULT_IDLE_TIMEOUT_MINUTES) * 60_000,
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      process.stderr.write(`Port ${config.port} is in use. Is the daemon already running? Try: ezapply status\n`);
      return 1;
    }
    throw err;
  }
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return new Promise<number>(() => {}); // run until signalled
}

/**
 * Claude Code in the workspace, restarted with a fresh session when the user captures another posting
 * (see chat.ts). Ctrl+C belongs to Claude: the wrapper ignores it and ends when Claude does.
 */
async function cmdChat(args: string[]): Promise<number> {
  const config = await requireConfig();
  const claude = findClaude();
  if (!claude) {
    process.stderr.write(
      "Claude Code isn't on PATH. Install it (https://code.claude.com/docs), or point EZAPPLY_CLAUDE at it.\n",
    );
    return 1;
  }
  await ensureDaemon(config, { cliMain: CLI_MAIN }).catch((err: Error) => process.stderr.write(`${err.message}\n`));
  process.on("SIGINT", () => {});
  return runChat({ claude, args, cwd: config.workspace, state: (session) => fetchChatState(config, session) });
}

/** Claude Code's MCP server: relay stdio to the daemon, starting it when needed. Nothing else may use stdout. */
async function cmdMcp(): Promise<number> {
  const config = await loadDaemonConfig();
  if (!config) {
    process.stderr.write("ezapply is not set up yet. In the ezapply repo run: npm run setup\n");
    return 1;
  }
  const ensure = async () => {
    await ensureDaemon(config, { cliMain: CLI_MAIN });
  };
  await ensure().catch((err: Error) => process.stderr.write(`${err.message}\n`));
  await runMcpRelay({
    input: process.stdin,
    output: process.stdout,
    url: `http://${config.host}:${config.port}${MCP_PATH}`,
    token: config.mcpToken,
    // Under `ezapply chat`, name the session so the daemon can tell the wrapper when it's safe to restart.
    ...(process.env[CHAT_SESSION_ENV] ? { headers: { [CHAT_SESSION_HEADER]: process.env[CHAT_SESSION_ENV] } } : {}),
    ensureDaemon: ensure,
  });
  return 0;
}

async function cmdPair(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { reset: { type: "boolean" } } });
  let config = await requireConfig();
  if (values.reset) {
    const { pairedExtensionId: _, ...rest } = config;
    config = { ...rest, pairingToken: newPairingToken() };
    await saveDaemonConfig(config);
    process.stdout.write("Forgot the paired extension and made a new pairing code.\n");
  }
  await ensureDaemon(config, { cliMain: CLI_MAIN, restart: values.reset === true });

  if ((await pairingStatus(config)).connected) {
    process.stdout.write(`Paired and connected (${config.pairedExtensionId ?? "extension"}).\n`);
    return 0;
  }
  await openPairing(config, PAIR_WAIT_SECONDS);
  process.stdout.write(
    [
      "Pairing is open. Open the browser with the ezapply extension loaded: it pairs by itself.",
      `(Using another port? Enter port ${config.port} and code ${config.pairingToken} in the extension options.)`,
      ...(config.pairedExtensionId
        ? [`Only the paired extension (${config.pairedExtensionId}) can connect; for a new copy use --reset.`]
        : []),
      "Waiting… (Ctrl+C to stop)",
      "",
    ].join("\n"),
  );
  const ok = await waitFor(
    async () => ((await pairingStatus(config).catch(() => null))?.connected ? true : null),
    PAIR_WAIT_SECONDS * 1000,
    1000,
  );
  process.stdout.write(
    ok ? "Paired and connected.\n" : "Timed out. Run `ezapply pair` again when the extension is loaded.\n",
  );
  return ok ? 0 : 1;
}

async function cmdStatus(): Promise<number> {
  const config = await requireConfig();
  const health = await fetchHealth(config);
  if (!health) {
    process.stdout.write(`Daemon not reachable on ${config.host}:${config.port}. Start it with: ezapply start\n`);
    return 1;
  }
  process.stdout.write(
    `Daemon ${health.version} running on ${config.host}:${config.port}; extension ${health.extensionConnected ? "connected" : "not connected"}.\n`,
  );
  return 0;
}

async function requireConfig(): Promise<DaemonConfig> {
  const config = await loadDaemonConfig();
  if (!config) {
    process.stderr.write("No config found. Run: ezapply init\n");
    process.exit(1);
  }
  return config;
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code !== 0) process.exitCode = code;
  },
  (err: unknown) => {
    // Expected problems (bad input, a damaged config) get one line and what to do; bugs keep their stack.
    if (err instanceof EzError) {
      process.stderr.write(`ezapply: ${err.message}\n${err.hint ? `${err.hint}\n` : ""}`);
    } else {
      process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
    }
    process.exitCode = 1;
  },
);

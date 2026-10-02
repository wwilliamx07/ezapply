#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  type AppConfig,
  appConfigPath,
  appDir,
  CHAT_SESSION_HEADER,
  COMPANION_VERSION,
  createLogger,
  DEFAULT_PORT,
  HEALTH_MODE,
  LEGACY_STATE_FILE,
  loadAppConfig,
  MCP_PATH,
  newPairingToken,
  newToken,
  saveAppConfig,
} from "@ezapply/companion";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { CHAT_SESSION_ENV, findClaude, hostChat } from "./chat.js";
import { runDebug } from "./debug.js";
import { runDoctor } from "./doctor.js";
import { fetchHealth } from "./health.js";
import { runMcpRelay } from "./mcp-relay.js";
import { guardProcess, quietProcess } from "./quiet.js";
import { type InitReport, initWorkspace } from "./workspace-init.js";

const CLI_MAIN = fileURLToPath(import.meta.url);
const EXTENSION_DIR = resolve(dirname(CLI_MAIN), "..", "..", "extension");

const USAGE = `ezapply ${COMPANION_VERSION}

Usage:
  ezapply chat [claude args…]                        Run ezapply and Claude Code in the workspace (how you use
                                                     ezapply); a newly captured posting starts a fresh session
  ezapply init [--workspace <dir>] [--port <n>]      Create or refresh the workspace and local config
  ezapply status                                     Check whether ezapply is running
  ezapply doctor                                     Diagnose the whole setup
  ezapply debug on|off|report|clean                  Autofill debug mode: record every form call under debug/
  ezapply mcp                                        MCP server on stdio (Claude Code runs this)
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "chat":
      return cmdChat(rest);
    case "init":
      return cmdInit(rest);
    case "status":
      return cmdStatus();
    case "doctor":
      return runDoctor();
    case "debug":
      return cmdDebug(rest);
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

/** Write ~/.ezapply/config.json (keeping tokens and pairing) and create or refresh the workspace. */
async function initConfig(opts: { workspace?: string; port?: string }): Promise<{
  config: AppConfig;
  report: InitReport;
}> {
  const existing = await loadAppConfig();
  const config: AppConfig = {
    schemaVersion: 1,
    host: "127.0.0.1",
    port: opts.port ? parsePort(opts.port) : (existing?.port ?? DEFAULT_PORT),
    mcpToken: existing?.mcpToken ?? newToken(),
    pairingToken: existing?.pairingToken ?? newPairingToken(),
    ...(existing?.pairedExtensionId ? { pairedExtensionId: existing.pairedExtensionId } : {}),
    workspace: resolve(opts.workspace ?? existing?.workspace ?? join(homedir(), "ezapply-home")),
  };
  await saveAppConfig(config);
  // What the background daemon of earlier builds remembered between runs; nothing reads it now.
  await rm(join(appDir(), LEGACY_STATE_FILE), { force: true });
  return { config, report: await initWorkspace(config) };
}

function parsePort(raw: string): number {
  const port = Number(raw);
  if (!/^\d+$/.test(raw.trim()) || port < 1 || port > 65535) {
    throw new EzError(ErrorCode.BadRequest, `--port must be a whole number from 1 to 65535, not "${raw}".`);
  }
  return port;
}

async function cmdDebug(args: string[]): Promise<number> {
  const config = await loadAppConfig();
  if (!config) {
    process.stderr.write("No ezapply config yet: run `ezapply init` first.\n");
    return 1;
  }
  return runDebug(config.workspace, args, (s) => process.stdout.write(s));
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
    `Config:    ${appConfigPath()}`,
    "",
    "Next:",
    `  cd "${config.workspace}"`,
    `  ${process.platform === "win32" ? ".\\ezapply" : "./ezapply"} chat`,
    'Then say "set me up". Claude checks what\'s missing (TeX, the browser extension, GitHub, your resume)',
    "and walks you through it. Always start ezapply this way: ezapply runs only while that chat is open, and",
    "capturing another posting starts a fresh Claude session by itself. If a chat is open now, exit it and",
    "start it again to use this build.",
    "",
  ];
  process.stdout.write(out.join("\n"));
  return 0;
}

/**
 * ezapply in the workspace: the companion in this process and Claude Code as its child, restarted with a
 * fresh session when the user captures another posting (see chat.ts). Ctrl+C belongs to Claude: the wrapper
 * ignores it and ends when Claude does.
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
  const log = createLogger();
  guardProcess(log);
  process.on("SIGINT", () => {});
  return hostChat({
    config,
    claude,
    args,
    extensionDir: EXTENSION_DIR,
    log,
    onStarted: (handle) => {
      // From here the terminal is Claude's.
      quietProcess(log);
      const end = () => {
        void handle.close().finally(() => process.exit(129));
      };
      process.on("SIGTERM", end);
      process.on("SIGHUP", end);
    },
  });
}

/** Claude Code's MCP server: relay stdio to the companion inside `ezapply chat`. Nothing else may use stdout. */
async function cmdMcp(): Promise<number> {
  const config = await loadAppConfig();
  if (!config) {
    process.stderr.write("ezapply is not set up yet. In the ezapply repo run: npm run setup\n");
    return 1;
  }
  await runMcpRelay({
    input: process.stdin,
    output: process.stdout,
    url: `http://${config.host}:${config.port}${MCP_PATH}`,
    token: config.mcpToken,
    // Under `ezapply chat`, name the session so the wrapper knows when it's safe to restart it.
    ...(process.env[CHAT_SESSION_ENV] ? { headers: { [CHAT_SESSION_HEADER]: process.env[CHAT_SESSION_ENV] } } : {}),
  });
  return 0;
}

async function cmdStatus(): Promise<number> {
  const config = await requireConfig();
  const health = await fetchHealth(config);
  if (!health) {
    process.stdout.write("ezapply isn't running. It runs while `ezapply chat` is open.\n");
    return 1;
  }
  if (health.mode !== HEALTH_MODE) {
    process.stdout.write(
      `A background daemon from an earlier ezapply build is running on port ${config.port}; ` +
        "`ezapply chat` stops it when it starts.\n",
    );
    return 1;
  }
  process.stdout.write(
    `ezapply ${health.version} is running in an \`ezapply chat\` on ${config.host}:${config.port}; ` +
      `extension ${health.extensionConnected ? "connected" : "not connected"}.\n`,
  );
  return 0;
}

async function requireConfig(): Promise<AppConfig> {
  const config = await loadAppConfig();
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

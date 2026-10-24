#!/usr/bin/env node
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
// Only the light entry at the top: the companion's index loads all of it (jsdom, pdfjs, the MCP server), close to
// 2 s on Windows, and `ezapply mcp` starts in Claude Code with every panel conversation. Each command imports the
// rest when it runs; test/cli.test.ts checks `mcp`'s module graph.
import {
  type AppConfig,
  appConfigPath,
  COMPANION_VERSION,
  DEFAULT_PORT,
  loadAppConfig,
  MCP_PATH,
  newPairingToken,
  newToken,
  SESSION_ENV,
  SESSION_HEADER,
  saveAppConfig,
} from "@ezapply/companion/light";
import { ErrorCode, EzError } from "@ezapply/protocol";
import type { InitReport } from "./workspace-init.js";

const CLI_MAIN = fileURLToPath(import.meta.url);
const EXTENSION_DIR = resolve(dirname(CLI_MAIN), "..", "..", "extension");

const USAGE = `ezapply ${COMPANION_VERSION}

Usage:
  ezapply                                            Run ezapply for the browser's side panel; Ctrl+C stops it
  ezapply help                                       This list
  ezapply init [--workspace <dir>] [--port <n>]      Create or refresh the workspace and local config
  ezapply doctor                                     Diagnose the whole setup, and whether ezapply is running
  ezapply debug on|off|report|clean|export           Debug mode: record every form call under debug/
  ezapply mcp                                        MCP server on stdio (Claude Code runs this)
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "init":
      return cmdInit(rest);
    case "doctor":
      return (await import("./doctor.js")).runDoctor();
    case "debug":
      return cmdDebug(rest);
    case "mcp":
      return cmdMcp();
    case undefined:
      return cmdPanel();
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
  const { initWorkspace } = await import("./workspace-init.js");
  const antigravityHome = join(homedir(), ".gemini", "antigravity-cli");
  return { config, report: await initWorkspace(config, { antigravityHome }) };
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
  const { runDebug } = await import("./debug.js");
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
    `  ${process.platform === "win32" ? ".\\ezapply" : "./ezapply"}`,
    "A setup page opens in your browser for what's missing (TeX, the browser extension, GitHub, your resume), and",
    "Claude does the parts that need it. From then on you work in the ezapply panel (the toolbar button in your",
    "browser); ezapply runs while that command does.",
    "If ezapply is running now, stop it and start it again to use this build.",
    "",
  ];
  process.stdout.write(out.join("\n"));
  return 0;
}

/** ezapply for the side panel: the companion in this process, the chosen agent started headless by it when needed. */
async function cmdPanel(): Promise<number> {
  const config = await requireConfig();
  const [{ createLogger, findAntigravity, findClaude, findCodex }, { hostPanel }, { guardProcess, quietProcess }] =
    await Promise.all([import("@ezapply/companion"), import("./panel.js"), import("./quiet.js")]);
  const claude = findClaude();
  const antigravity = findAntigravity();
  const codex = findCodex();
  if (!claude && !antigravity && !codex) {
    process.stderr.write(
      "None of Claude Code, the Antigravity CLI (agy) or Codex is on PATH. Install one " +
        "(https://code.claude.com/docs, https://antigravity.google/docs/cli, https://developers.openai.com/codex), " +
        "or point EZAPPLY_CLAUDE, EZAPPLY_ANTIGRAVITY or EZAPPLY_CODEX at it.\n",
    );
    return 1;
  }
  const log = createLogger();
  guardProcess(log);
  // Libraries print (pdfjs through console.log); the terminal shows only ezapply's own lines (on stdout).
  return hostPanel({
    config,
    ...(claude ? { claude } : {}),
    ...(antigravity ? { antigravity } : {}),
    ...(codex ? { codex } : {}),
    extensionDir: EXTENSION_DIR,
    log,
    onStarted: () => quietProcess(log),
  });
}

/** Claude Code's MCP server: relay stdio to the companion inside `ezapply`. Nothing else may use stdout. */
async function cmdMcp(): Promise<number> {
  const config = await loadAppConfig();
  if (!config) {
    process.stderr.write("ezapply is not set up yet. In the ezapply repo run: npm run setup\n");
    return 1;
  }
  const { runMcpRelay } = await import("./mcp-relay.js");
  await runMcpRelay({
    input: process.stdin,
    output: process.stdout,
    url: `http://${config.host}:${config.port}${MCP_PATH}`,
    token: config.mcpToken,
    // The panel's agent names its conversation, so the tools know which one a call comes from.
    ...(process.env[SESSION_ENV] ? { headers: { [SESSION_HEADER]: process.env[SESSION_ENV] } } : {}),
  });
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

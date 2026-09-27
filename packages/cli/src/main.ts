#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  agentFileStatus,
  appDir,
  COMPANION_VERSION,
  createLogger,
  type DaemonConfig,
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  DEFAULT_PORT,
  daemonConfigPath,
  KeyringStore,
  loadDaemonConfig,
  MCP_PATH,
  newPairingToken,
  newToken,
  resolveEngine,
  saveDaemonConfig,
  startCompanion,
  Workspace,
  which,
} from "@ezapply/companion";
import { PROTOCOL_VERSION } from "@ezapply/protocol";
import { ensureDaemon, fetchHealth, openPairing, pairingStatus, stopDaemon, waitFor } from "./daemonctl.js";
import { runMcpRelay } from "./mcp-relay.js";
import { type InitReport, initWorkspace } from "./workspace-init.js";

const CLI_MAIN = fileURLToPath(import.meta.url);
const EXTENSION_DIR = resolve(dirname(CLI_MAIN), "..", "..", "extension");
const PAIR_WAIT_SECONDS = 10 * 60;

const USAGE = `ezapply ${COMPANION_VERSION}

Usage:
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
      return cmdDoctor();
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
    port: opts.port ? Number(opts.port) : (existing?.port ?? DEFAULT_PORT),
    mcpToken: existing?.mcpToken ?? newToken(),
    pairingToken: existing?.pairingToken ?? newPairingToken(),
    ...(existing?.pairedExtensionId ? { pairedExtensionId: existing.pairedExtensionId } : {}),
    ...(existing?.idleTimeoutMinutes !== undefined ? { idleTimeoutMinutes: existing.idleTimeoutMinutes } : {}),
    workspace: resolve(opts.workspace ?? existing?.workspace ?? join(homedir(), "ezapply-home")),
  };
  await saveDaemonConfig(config);
  return { config, report: await initWorkspace(config) };
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
    "  claude",
    'Then say "set me up". Claude checks what\'s missing (TeX, the browser extension, GitHub, your resume)',
    "and walks you through it. If the daemon was running an older build: ezapply restart",
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

async function cmdDoctor(): Promise<number> {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const major = Number(process.versions.node.split(".")[0]);
  add("node", major >= 22, `v${process.versions.node} (need >= 22)`);

  const config = await loadDaemonConfig().catch((e: Error) => {
    add("daemon config", false, e.message);
    return null;
  });
  if (config) {
    add("daemon config", true, daemonConfigPath());
    try {
      await new Workspace(config.workspace).readConfig();
      add("workspace", true, config.workspace);
    } catch (e) {
      add("workspace", false, `${config.workspace}: ${(e as Error).message} (run ezapply init)`);
    }
    const agent = await agentFileStatus(config.workspace);
    add("agent file", agent.done, agent.detail);
    const health = await fetchHealth(config);
    add(
      "daemon",
      Boolean(health),
      health ? `v${health.version} on port ${config.port}` : "not running (ezapply start)",
    );
    if (health) {
      add(
        "protocol",
        health.protocolVersion === PROTOCOL_VERSION,
        `daemon v${health.protocolVersion}, cli v${PROTOCOL_VERSION}`,
      );
      add(
        "extension",
        health.extensionConnected,
        health.extensionConnected ? "connected" : "not connected (open the browser / pair)",
      );
    }
    add("extension paired", Boolean(config.pairedExtensionId), config.pairedExtensionId ?? "not yet (ezapply pair)");
  } else {
    add("daemon config", false, "missing (run ezapply init)");
  }

  // GitHub (optional until onboarding reaches it).
  const appFile = join(appDir(), "github-app.json");
  const appRegistered = await readFile(appFile, "utf8").then(
    () => true,
    () => false,
  );
  const token = await new KeyringStore().get("github-user-token");
  const login = token ? (JSON.parse(token) as { login?: string }).login : undefined;
  add(
    "github",
    true,
    appRegistered
      ? login
        ? `logged in as ${login}`
        : "app registered, not logged in"
      : "not set up yet (onboarding does this)",
  );

  // Documents: the engine is required; the rest are optional helpers.
  const wsConfig = config ? await new Workspace(config.workspace).readConfig().catch(() => null) : null;
  const configured = wsConfig?.tex.engine ?? "auto";
  const engine = await resolveEngine(configured);
  add(
    "tex engine",
    Boolean(engine),
    engine
      ? `${engine.id}${configured === "auto" ? " (auto)" : ""} at ${which(engine.id) ?? "?"}`
      : `none usable for "${configured}" (install MiKTeX: winget install MiKTeX.MiKTeX, then ezapply restart)`,
  );
  const optional = (name: string, bins: string[], why: string) => {
    const found = bins.map((b) => which(b)).find(Boolean);
    add(name, true, found ?? `not installed (optional: ${why})`);
  };
  optional("latexdiff", ["latexdiff"], "change-highlighted PDFs");
  optional("ghostscript", ["gswin64c", "gswin32c", "gs"], "shrinking image-heavy PDFs");

  const width = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) process.stdout.write(`${c.ok ? " ok " : "FAIL"}  ${c.name.padEnd(width)}  ${c.detail}\n`);
  return checks.some((c) => !c.ok) ? 1 : 0;
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
    process.stderr.write(`${(err as Error).stack ?? String(err)}\n`);
    process.exitCode = 1;
  },
);

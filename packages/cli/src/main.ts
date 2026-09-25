#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  appDir,
  COMPANION_VERSION,
  createLogger,
  type DaemonConfig,
  DEFAULT_PORT,
  daemonConfigPath,
  HEALTH_PATH,
  KeyringStore,
  loadDaemonConfig,
  newPairingToken,
  newToken,
  resolveEngine,
  saveDaemonConfig,
  startCompanion,
  Workspace,
  which,
} from "@ezapply/companion";
import { PROTOCOL_VERSION } from "@ezapply/protocol";
import { initWorkspace } from "./workspace-init.js";

const EXTENSION_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "extension");
const EXTENSION_DIST = join(EXTENSION_DIR, "dist");
const FIREFOX_MANIFEST = join(EXTENSION_DIR, "dist-firefox", "manifest.json");

const USAGE = `ezapply ${COMPANION_VERSION}

Usage:
  ezapply init [--workspace <dir>] [--port <n>]   Create or refresh the workspace and local config
  ezapply daemon                                  Run the companion (MCP server + extension bridge)
  ezapply pair [--reset]                          Show the extension pairing code (--reset: new code, unpin extension)
  ezapply status                                  Check whether the daemon is running
  ezapply doctor                                  Diagnose the whole setup
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "init":
      return cmdInit(rest);
    case "daemon":
      return cmdDaemon();
    case "pair":
      return cmdPair(rest);
    case "status":
      return cmdStatus();
    case "doctor":
      return cmdDoctor();
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

async function cmdInit(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { workspace: { type: "string" }, port: { type: "string" } } });
  const existing = await loadDaemonConfig();
  const config: DaemonConfig = {
    schemaVersion: 1,
    host: "127.0.0.1",
    port: values.port ? Number(values.port) : (existing?.port ?? DEFAULT_PORT),
    mcpToken: existing?.mcpToken ?? newToken(),
    pairingToken: existing?.pairingToken ?? newPairingToken(),
    ...(existing?.pairedExtensionId ? { pairedExtensionId: existing.pairedExtensionId } : {}),
    workspace: resolve(values.workspace ?? existing?.workspace ?? join(homedir(), "ezapply-home")),
  };
  await saveDaemonConfig(config);
  const report = await initWorkspace(config);

  const out = [
    `Workspace: ${config.workspace}`,
    ...report.created.map((p) => `  created  ${p}`),
    ...report.updated.map((p) => `  updated  ${p}`),
    ...report.kept.map((p) => `  kept     ${p}`),
    "",
    `Config:    ${daemonConfigPath()}`,
    "",
    "Next steps:",
    "  1. Start the companion:   ezapply daemon   (leave it running)",
    `  2. Load the extension:    Chrome: chrome://extensions → Developer mode → Load unpacked → ${EXTENSION_DIST}`,
    `                            Firefox: about:debugging → This Firefox → Load Temporary Add-on → ${FIREFOX_MANIFEST}`,
    `  3. Pair it:               extension options → port ${config.port}, code ${config.pairingToken}`,
    `  4. Run Claude Code in:    ${config.workspace}`,
    "",
  ];
  process.stdout.write(out.join("\n"));
  return 0;
}

async function cmdDaemon(): Promise<number> {
  const config = await requireConfig();
  const log = createLogger();
  let handle: Awaited<ReturnType<typeof startCompanion>>;
  try {
    handle = await startCompanion({ config, log });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      process.stderr.write(`Port ${config.port} is in use. Is the daemon already running? Try: ezapply status\n`);
      return 1;
    }
    throw err;
  }
  const shutdown = async () => {
    log.info("shutting down");
    await handle.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return new Promise<number>(() => {}); // run until signalled
}

async function cmdPair(args: string[]): Promise<number> {
  const { values } = parseArgs({ args, options: { reset: { type: "boolean" } } });
  let config = await requireConfig();
  if (values.reset) {
    const { pairedExtensionId: _, ...rest } = config;
    config = { ...rest, pairingToken: newPairingToken() };
    await saveDaemonConfig(config);
    process.stdout.write("New pairing code generated and extension unpinned. Restart the daemon to apply.\n");
  }
  process.stdout.write(
    [
      `Pairing code: ${config.pairingToken}`,
      `Port:         ${config.port}`,
      `Pinned:       ${config.pairedExtensionId ?? "(not yet paired)"}`,
      "Paste these into the ezapply extension's options page.",
      "",
    ].join("\n"),
  );
  return 0;
}

async function cmdStatus(): Promise<number> {
  const config = await requireConfig();
  const health = await fetchHealth(config);
  if (!health) {
    process.stdout.write(`Daemon not reachable on ${config.host}:${config.port}. Start it with: ezapply daemon\n`);
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
    const health = await fetchHealth(config);
    add(
      "daemon",
      Boolean(health),
      health ? `v${health.version} on port ${config.port}` : "not running (ezapply daemon)",
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
      : `none usable for "${configured}" (install MiKTeX: winget install MiKTeX.MiKTeX, then restart the daemon)`,
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

async function fetchHealth(
  config: DaemonConfig,
): Promise<{ version: string; protocolVersion: number; extensionConnected: boolean } | null> {
  try {
    const res = await fetch(`http://${config.host}:${config.port}${HEALTH_PATH}`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok
      ? ((await res.json()) as { version: string; protocolVersion: number; extensionConnected: boolean })
      : null;
  } catch {
    return null;
  }
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

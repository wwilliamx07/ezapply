import {
  type AgentCommand,
  type AppConfig,
  type ClaudeCommand,
  type CompanionHandle,
  type Logger,
  type Opener,
  startCompanion,
  workspaceStatus,
} from "@ezapply/companion";
import { fetchHealth } from "./health.js";

export interface HostPanelOptions {
  config: AppConfig;
  /** The extension package folder, so extension_pair can say what to load. */
  extensionDir?: string;
  /** The agents the panel can run (at least one): Claude Code and the Antigravity CLI. */
  claude?: ClaudeCommand;
  antigravity?: AgentCommand;
  log: Logger;
  /** Where the lines for the user go (stdout). */
  say?: (line: string) => void;
  /** Where a failure to start is reported (stderr). */
  fail?: (line: string) => void;
  /** Resolves when ezapply should stop (Ctrl+C, the terminal closing); tests resolve it themselves. */
  stopped?: Promise<void>;
  onStarted?: (handle: CompanionHandle) => void;
  /** Test hooks for the companion. */
  companion?: { appDataDir?: string; saveConfig?: (config: AppConfig) => Promise<void>; opener?: Opener };
}

/**
 * `ezapply`: the companion in this process, for the extension's side panel, with Claude Code run headless by the
 * companion when the panel needs it ([agent](../../../references/components/agent.md)). Nothing runs in the
 * terminal but this: it prints where to go and stops on Ctrl+C. It is the only process the companion runs in,
 * and the port closes when it stops.
 */
export async function hostPanel(opts: HostPanelOptions): Promise<number> {
  const say = opts.say ?? ((line: string) => process.stdout.write(`${line}\n`));
  const fail = opts.fail ?? ((line: string) => process.stderr.write(`${line}\n`));
  const started = await startHosted(opts);
  if (typeof started === "string") {
    fail(started);
    return 1;
  }
  started.onServerError((err) => opts.log.error({ err: err.message }, "panel: companion server error"));
  opts.onStarted?.(started);
  say(`ezapply is running (port ${started.port}).`);
  // Until setup is done there may be no extension, and so no panel: setup is a page of its own.
  const ready = (await workspaceStatus(started.services, { atLaunch: true }).catch(() => null))?.ready ?? true;
  if (!ready) {
    const { url } = started.services.onboarding.open();
    const openedIn = await started.services.opener.url(url).catch(() => null);
    say(
      openedIn ? "Setup isn't finished: the setup page opened in your browser." : `Setup isn't finished: open ${url}`,
    );
  }
  say("Open the ezapply panel from your browser's toolbar. Press Ctrl+C here to stop ezapply.");
  await (opts.stopped ?? stopSignal());
  await started.close();
  return 0;
}

/** The started companion, or what to tell the user when the port is taken. */
async function startHosted(opts: HostPanelOptions): Promise<CompanionHandle | string> {
  const { config } = opts;
  try {
    return await startCompanion({
      config,
      log: opts.log,
      ...(opts.claude ? { claude: opts.claude } : {}),
      ...(opts.antigravity ? { antigravity: opts.antigravity } : {}),
      ...(opts.extensionDir ? { extensionDir: opts.extensionDir } : {}),
      ...(opts.companion?.appDataDir ? { appDataDir: opts.companion.appDataDir } : {}),
      ...(opts.companion?.saveConfig ? { saveConfig: opts.companion.saveConfig } : {}),
      ...(opts.companion?.opener ? { opener: opts.companion.opener } : {}),
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
  }
  if (await fetchHealth(config)) {
    return `ezapply is already running in another terminal (port ${config.port}). Use that one, or stop it first.`;
  }
  return (
    `Port ${config.port} is in use by another program. Close it, or move ezapply to a free port: ` +
    "`ezapply init --port <n>`, then enter the same port in the extension's options."
  );
}

/** Ctrl+C, or the terminal closing. */
function stopSignal(): Promise<void> {
  return new Promise((resolve) => {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, () => resolve());
  });
}

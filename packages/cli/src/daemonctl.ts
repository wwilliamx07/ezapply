import { spawn } from "node:child_process";
import { join } from "node:path";
import { appDir, type DaemonConfig, HEALTH_PATH, PAIR_PATH, SHUTDOWN_PATH, waitFor } from "@ezapply/companion";

export interface Health {
  version: string;
  protocolVersion: number;
  extensionConnected: boolean;
}

export interface PairingStatus {
  openUntil?: string;
  pairedExtensionId?: string;
  connected: boolean;
}

const baseUrl = (config: DaemonConfig) => `http://${config.host}:${config.port}`;

/** The daemon's liveness probe, or null when nothing (or something that isn't ezapply) answers. */
export async function fetchHealth(config: DaemonConfig): Promise<Health | null> {
  try {
    const res = await fetch(`${baseUrl(config)}${HEALTH_PATH}`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const body = (await res.json()) as Health & { name?: string };
    return body.name === "ezapply" ? body : null;
  } catch {
    return null;
  }
}

/** Call a /control route with the MCP token. */
export async function control<T>(
  config: DaemonConfig,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${baseUrl(config)}${path}`, {
    method,
    headers: { authorization: `Bearer ${config.mcpToken}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`daemon answered ${res.status} for ${path}`);
  return (await res.json()) as T;
}

export const openPairing = (config: DaemonConfig, seconds: number) =>
  control<PairingStatus>(config, PAIR_PATH, "POST", { seconds });
export const pairingStatus = (config: DaemonConfig) => control<PairingStatus>(config, PAIR_PATH, "GET");

/**
 * Make sure a daemon is running, starting one in the background if needed. With `restart`, a running
 * daemon is stopped first so it picks up a new build or config.
 */
export async function ensureDaemon(
  config: DaemonConfig,
  opts: { cliMain: string; restart?: boolean },
): Promise<{ started: boolean; health: Health }> {
  const running = await fetchHealth(config);
  if (running && !opts.restart) return { started: false, health: running };
  if (running) await stopDaemon(config);

  const child = spawn(process.execPath, [opts.cliMain, "daemon"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();

  const health = await waitFor(() => fetchHealth(config), 20_000);
  if (!health) {
    throw new Error(
      `The daemon did not start on port ${config.port}. Run \`ezapply daemon\` to see the error ` +
        `(log: ${join(appDir(), "logs", "companion.log")}).`,
    );
  }
  return { started: true, health };
}

/** Ask a running daemon to exit and wait until it has. Returns false if none was running. */
export async function stopDaemon(config: DaemonConfig): Promise<boolean> {
  if (!(await fetchHealth(config))) return false;
  await control(config, SHUTDOWN_PATH, "POST").catch(() => undefined);
  const gone = await waitFor(async () => ((await fetchHealth(config)) ? null : true), 10_000);
  if (!gone) throw new Error(`The daemon on port ${config.port} did not stop.`);
  return true;
}

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { z } from "zod";

/**
 * Machine-level daemon settings, stored outside the workspace in ~/.ezapply/daemon.json
 * (or $EZAPPLY_APP_DIR). Holds the local secrets that the MCP client and extension present.
 */
export const DaemonConfig = z.object({
  schemaVersion: z.literal(1),
  host: z.literal("127.0.0.1"),
  port: z.number().int().min(1).max(65535),
  /** Bearer token for /mcp and /control, presented by `ezapply mcp` and the CLI. Never written into the workspace. */
  mcpToken: z.string().min(32),
  /** Code the extension presents; handed to it automatically while pairing is open (extension_pair). */
  pairingToken: z.string().min(16),
  /** Extension id pinned on first successful pairing (Chrome extension id or Firefox install UUID). */
  pairedExtensionId: z.string().optional(),
  /** Absolute path of the workspace (ezapply-home). */
  workspace: z.string(),
  /** Minutes without work before the daemon stops (default 15; 0 = never). Claude Code starts it again. */
  idleTimeoutMinutes: z.number().min(0).optional(),
});
export type DaemonConfig = z.infer<typeof DaemonConfig>;

export const DEFAULT_PORT = 17373;
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 15;

export function appDir(): string {
  return process.env.EZAPPLY_APP_DIR ?? join(homedir(), ".ezapply");
}

export function daemonConfigPath(): string {
  return join(appDir(), "daemon.json");
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Human-typable pairing code, e.g. "K7QF-2M9X-PLDA-8RWC". */
export function newPairingToken(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += alphabet[(bytes[i] ?? 0) % alphabet.length];
    if (i % 4 === 3 && i < 15) out += "-";
  }
  return out;
}

/** The config, or null when there is none. A damaged file fails with what to do, not a stack trace. */
export async function loadDaemonConfig(path = daemonConfigPath()): Promise<DaemonConfig | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw invalidConfig(path, `not valid JSON (${(err as Error).message})`);
  }
  const parsed = DaemonConfig.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw invalidConfig(path, issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "invalid");
  }
  return parsed.data;
}

function invalidConfig(path: string, why: string): EzError {
  return new EzError(
    ErrorCode.BadRequest,
    `${path} is invalid: ${why}.`,
    "Fix it, or delete it and run `ezapply init` (a new file means pairing the extension again).",
  );
}

export async function saveDaemonConfig(config: DaemonConfig, path = daemonConfigPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(DaemonConfig.parse(config), null, 2)}\n`, { mode: 0o600 });
}

/**
 * Change some fields of daemon.json as it is on disk now. The running daemon uses this for pairing changes,
 * so edits made meanwhile (`ezapply init --port`, `idleTimeoutMinutes`) aren't overwritten by its old copy.
 * `fallback` is used when the file has gone or can't be read.
 */
export async function updateDaemonConfig(
  change: (current: DaemonConfig) => DaemonConfig,
  fallback: DaemonConfig,
  path = daemonConfigPath(),
): Promise<DaemonConfig> {
  const current = (await loadDaemonConfig(path).catch(() => null)) ?? fallback;
  const next = change(current);
  await saveDaemonConfig(next, path);
  return next;
}

/** ~/.ezapply/daemon-state.json: what the daemon remembers between runs (not settings). */
export const DaemonState = z.object({
  schemaVersion: z.literal(1),
  /** When the extension was last connected (epoch ms): decides whether a fresh daemon waits for it. */
  extensionLastSeenAt: z.number().optional(),
});
export type DaemonState = z.infer<typeof DaemonState>;

export function daemonStatePath(dir = appDir()): string {
  return join(dir, "daemon-state.json");
}

export async function loadDaemonState(path: string): Promise<DaemonState> {
  const raw = await readFile(path, "utf8").catch(() => null);
  let json: unknown = null;
  try {
    json = raw === null ? null : JSON.parse(raw);
  } catch {
    // unreadable state is no state
  }
  const parsed = DaemonState.safeParse(json);
  return parsed.success ? parsed.data : { schemaVersion: 1 };
}

export async function saveDaemonState(path: string, state: DaemonState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(DaemonState.parse(state), null, 2)}\n`);
}

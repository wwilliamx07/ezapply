import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { z } from "zod";

/**
 * Machine-level settings, stored outside the workspace in ~/.ezapply/config.json (or $EZAPPLY_APP_DIR).
 * Holds the local secrets that the MCP relay and the extension present.
 */
export const AppConfig = z.object({
  schemaVersion: z.literal(1),
  host: z.literal("127.0.0.1"),
  port: z.number().int().min(1).max(65535),
  /** Bearer token for /mcp, presented by `ezapply mcp`. Never written into the workspace. */
  mcpToken: z.string().min(32),
  /** Code the extension presents; handed to it automatically while pairing is open (extension_pair). */
  pairingToken: z.string().min(16),
  /** Extension id pinned on first successful pairing (the extension id). */
  pairedExtensionId: z.string().optional(),
  /** Absolute path of the workspace (ezapply-home). */
  workspace: z.string(),
});
export type AppConfig = z.infer<typeof AppConfig>;

export const DEFAULT_PORT = 17373;

export function appDir(): string {
  return process.env.EZAPPLY_APP_DIR ?? join(homedir(), ".ezapply");
}

export function appConfigPath(): string {
  return join(appDir(), "config.json");
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
export async function loadAppConfig(path = appConfigPath()): Promise<AppConfig | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw invalidConfig(path, `not valid JSON (${(err as Error).message})`);
  }
  const parsed = AppConfig.safeParse(json);
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

export async function saveAppConfig(config: AppConfig, path = appConfigPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(AppConfig.parse(config), null, 2)}\n`, { mode: 0o600 });
}

/**
 * Change some fields of config.json as it is on disk now. The running companion uses this for pairing
 * changes, so edits made meanwhile (`ezapply init --port`) aren't overwritten by its old copy.
 * `fallback` is used when the file has gone or can't be read.
 */
export async function updateAppConfig(
  change: (current: AppConfig) => AppConfig,
  fallback: AppConfig,
  path = appConfigPath(),
): Promise<AppConfig> {
  const current = (await loadAppConfig(path).catch(() => null)) ?? fallback;
  const next = change(current);
  await saveAppConfig(next, path);
  return next;
}

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
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
});
export type DaemonConfig = z.infer<typeof DaemonConfig>;

export const DEFAULT_PORT = 17373;

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

export async function loadDaemonConfig(path = daemonConfigPath()): Promise<DaemonConfig | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return DaemonConfig.parse(JSON.parse(raw));
}

export async function saveDaemonConfig(config: DaemonConfig, path = daemonConfigPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(DaemonConfig.parse(config), null, 2)}\n`, { mode: 0o600 });
}

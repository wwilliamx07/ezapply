import { existsSync } from "node:fs";
import { join } from "node:path";
import { newPairingToken } from "../config/app.js";
import type { Services } from "../services.js";

export const PAIRING_MS = 15 * 60_000;

/** Where the user loads the extension from, and whether it's built. */
export function extensionFolders(s: Services): { built: boolean; chrome?: string } {
  const dir = s.extensionDir;
  const chrome = dir ? join(dir, "dist") : undefined;
  const built = Boolean(chrome && existsSync(join(chrome, "manifest.json")));
  return { built, ...(chrome ? { chrome } : {}) };
}

/**
 * Open the pairing window (`extension_pair`, and the onboarding page's extension step): for 15 minutes an
 * extension that connects without a code is accepted and pinned. `replace` forgets the paired one first.
 */
export async function startPairing(s: Services, replace = false) {
  if (replace) await s.bridge.forgetPaired(newPairingToken());
  const status = s.bridge.status();
  if (status.connected) return { connected: true as const, status, ...extensionFolders(s) };
  s.bridge.openPairing(PAIRING_MS);
  return { connected: false as const, status, ...extensionFolders(s) };
}

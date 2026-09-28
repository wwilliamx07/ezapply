import { type AppConfig, HEALTH_PATH } from "@ezapply/companion";

export interface Health {
  /** "chat" for this build; missing on a background daemon from an earlier build. */
  mode?: string;
  version: string;
  protocolVersion: number;
  extensionConnected: boolean;
}

/** What answers /health on the configured port, or null when nothing (or something that isn't ezapply) does. */
export async function fetchHealth(config: AppConfig): Promise<Health | null> {
  try {
    const res = await fetch(`http://${config.host}:${config.port}${HEALTH_PATH}`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Health & { name?: string };
    return body.name === "ezapply" ? body : null;
  } catch {
    return null;
  }
}

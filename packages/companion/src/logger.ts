import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pino, { type Logger } from "pino";
import { appDir } from "./config/daemon.js";

export type { Logger };

/**
 * Structured logs go to ~/.ezapply/logs/companion.log. Anything that could hold personal
 * data (page content, form values, tokens) is redacted by path; log ids and sizes instead.
 */
export function createLogger(opts: { level?: string; toFile?: boolean } = {}): Logger {
  const redact = {
    paths: [
      "*.html",
      "*.visibleHtml",
      "*.visibleText",
      "*.pairingToken",
      "*.mcpToken",
      "*.token",
      "*.value",
      "headers.authorization",
    ],
    censor: "[redacted]",
  };
  const level = opts.level ?? process.env.EZAPPLY_LOG_LEVEL ?? "info";
  if (opts.toFile === false) return pino({ level, redact });
  const dir = join(appDir(), "logs");
  mkdirSync(dir, { recursive: true });
  return pino(
    { level, redact },
    pino.multistream([
      { stream: pino.destination({ dest: join(dir, "companion.log"), mkdir: true, sync: false }) },
      { stream: process.stderr },
    ]),
  );
}

import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import pino, { type Logger } from "pino";
import { appDir } from "./config/app.js";

export type { Logger };

/** companion.log is rotated once it passes this size: companion.log → .1 → .2, the oldest dropped. */
export const LOG_MAX_BYTES = 5 * 1024 * 1024;
export const LOG_KEEP = 3;
const ROTATE_CHECK_MS = 10 * 60_000;

/**
 * Structured logs go to ~/.ezapply/logs/companion.log, and only there: the companion runs inside
 * `ezapply chat`, whose terminal belongs to Claude. Anything that could hold personal data (page content,
 * form values, tokens) is redacted by path; log ids and sizes instead. `toFile: false` (tests) logs to stdout.
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
  const file = join(dir, "companion.log");
  // Every run appends to the same file, so check at start and then now and again.
  rotateLog(file);
  const dest = pino.destination({ dest: file, mkdir: true, sync: false });
  const timer = setInterval(() => {
    if (rotateLog(file)) dest.reopen();
  }, ROTATE_CHECK_MS);
  timer.unref();
  return pino({ level, redact }, dest);
}

/**
 * Keep `keep` files of at most about `maxBytes` each: when `file` is over the limit, shift file.1 → file.2
 * and so on (dropping the oldest), and file → file.1. Returns whether it rotated; failures (a file held open
 * elsewhere) just leave the log growing until the next check.
 */
export function rotateLog(file: string, maxBytes = LOG_MAX_BYTES, keep = LOG_KEEP): boolean {
  try {
    if (!existsSync(file) || statSync(file).size <= maxBytes) return false;
    rmSync(`${file}.${keep - 1}`, { force: true });
    for (let n = keep - 2; n >= 1; n--) {
      if (existsSync(`${file}.${n}`)) renameSync(`${file}.${n}`, `${file}.${n + 1}`);
    }
    renameSync(file, `${file}.1`);
    return true;
  } catch {
    return false;
  }
}

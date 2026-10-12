import { format } from "node:util";
import type { Logger } from "@ezapply/companion";

/**
 * `ezapply`'s terminal shows only its own few lines. Libraries the companion uses may still print (pdfjs
 * through console.log, a dependency's warning on stderr), so send the console and stderr to the log. stdout
 * itself is left alone: ezapply's own lines go there.
 */
export function quietProcess(log: Logger): void {
  const to =
    (level: "debug" | "info" | "warn" | "error") =>
    (...args: unknown[]) =>
      log[level]({ source: "console" }, format(...args));
  console.log = to("info");
  console.info = to("info");
  console.debug = to("debug");
  console.trace = to("debug");
  console.warn = to("warn");
  console.error = to("error");
  process.stderr.write = ((chunk: string | Uint8Array, encoding?: unknown, cb?: unknown) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    if (text.trim()) log.warn({ source: "stderr" }, text.trimEnd());
    const done = typeof encoding === "function" ? encoding : cb;
    if (typeof done === "function") process.nextTick(done as () => void);
    return true;
  }) as typeof process.stderr.write;
}

/**
 * A bug in companion code must not end `ezapply`: that would take Claude's tools and the extension's
 * connection away mid-session. Log it and keep serving. Node discourages carrying on after an uncaught exception,
 * but the alternative here is worse: every error the companion can expect is already caught per request.
 */
export function guardProcess(log: Logger): void {
  process.on("uncaughtException", (err) => {
    log.error({ err: err.stack ?? err.message }, "uncaught exception; carrying on");
  });
  process.on("unhandledRejection", (reason) => {
    log.error(
      { err: reason instanceof Error ? (reason.stack ?? reason.message) : String(reason) },
      "unhandled rejection; carrying on",
    );
  });
}

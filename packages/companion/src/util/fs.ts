import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ErrorCode, EzError } from "@ezapply/protocol";

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Parsed JSON, or null when the file doesn't exist. Other read errors and bad JSON throw. */
export async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** How long a rename keeps retrying a target something else has open, as graceful-fs does on Windows. */
const LOCK_RETRY_MS = 2000;

function isLockError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}

/**
 * Write via a temp file and rename, so a crash never leaves a half-written file. On Windows the rename fails
 * while any handle is open on the target, which a reader, a virus scan or the indexer holds for a moment, so it
 * retries for about 2 s before reporting a lock. Only a PDF's lock is blamed on a viewer (Acrobat locks the PDFs
 * it shows); anything else is told to retry.
 */
export async function writeFileAtomic(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, content, typeof content === "string" ? "utf8" : undefined);
  const deadline = Date.now() + LOCK_RETRY_MS;
  for (let delay = 20; ; delay = Math.min(delay * 2, 500)) {
    try {
      await rename(tmp, path);
      return;
    } catch (err) {
      if (isLockError(err) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      await rm(tmp, { force: true });
      if (!isLockError(err)) throw err;
      throw new EzError(
        ErrorCode.BadRequest,
        `${path} is locked by another program.`,
        path.toLowerCase().endsWith(".pdf")
          ? "Ask the user to close the file in the program showing it (PDF viewers lock open files), then retry."
          : "Retry the call; if it fails again, ask the user what has the file open.",
      );
    }
  }
}

export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(data, null, 2)}\n`);
}

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

/**
 * Write via a temp file and rename, so a crash never leaves a half-written file. A target another program
 * holds open (Acrobat locks the PDFs it shows) fails with a hint to close it.
 */
export async function writeFileAtomic(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, content, typeof content === "string" ? "utf8" : undefined);
  try {
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EBUSY" || code === "EPERM") {
      throw new EzError(
        ErrorCode.BadRequest,
        `${path} is locked by another program.`,
        "Ask the user to close the file in the program showing it (PDF viewers lock open files), then retry.",
      );
    }
    throw err;
  }
}

export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(data, null, 2)}\n`);
}

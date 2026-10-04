import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * 12 hex characters of SHA-256 over a set of files: each one's path (with forward slashes) and contents, in
 * path order, line endings normalised so a checkout with CRLF hashes the same as one with LF. A missing file
 * counts as empty. Used to notice that a template or its source folder changed.
 */
export async function hashFiles(root: string, files: readonly string[]): Promise<string> {
  const h = createHash("sha256");
  for (const f of [...files].map((p) => p.split("\\").join("/")).sort()) {
    const bytes = await readFile(join(root, f)).catch(() => Buffer.alloc(0));
    h.update(f).update("\0").update(bytes.toString("latin1").replace(/\r\n/g, "\n"), "latin1").update("\0");
  }
  return h.digest("hex").slice(0, 12);
}

/** 12 hex characters of SHA-256 over a value's JSON. */
export function hashValue(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex")
    .slice(0, 12);
}

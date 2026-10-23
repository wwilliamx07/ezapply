import { open } from "node:fs/promises";
import { join } from "node:path";

/**
 * What a sync means for the index: `current` (nothing that can change a fact changed), `reindex` (update from the
 * diff), `full` (never indexed) or `rebuild` (indexed at a commit that's gone, after a force-push: index anew). The
 * skill chose this from `indexedSha` and `changedSince` itself, the same way every time.
 */
export type IndexMode = "current" | "reindex" | "full" | "rebuild";

export function indexMode(indexed: boolean, changed: unknown[] | null): IndexMode {
  if (!indexed) return "full";
  if (changed === null) return "rebuild";
  return changed.length ? "reindex" : "current";
}

const LOCK_FILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "cargo.lock",
  "poetry.lock",
  "pipfile.lock",
  "uv.lock",
  "gemfile.lock",
  "composer.lock",
  "go.sum",
  "packages.lock.json",
  "podfile.lock",
  "pubspec.lock",
  "mix.lock",
  "flake.lock",
]);
const VENDORED = /(^|\/)(node_modules|vendor|third[_-]party|bower_components|\.yarn|Pods)\//i;
const GENERATED_DIRS = /(^|\/)(dist|build|out|target|coverage|\.next|__generated__|generated)\//i;
const GENERATED_FILES =
  /(\.min\.(js|css)|\.map|\.pb\.go|_pb2\.pyi?|\.g\.dart|\.designer\.cs|\.generated\.[a-z]+|\.snap)$/i;

/** A lock file, a vendored or generated path: nothing a claim's facts come from. */
export function ignoredPath(path: string): boolean {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  return LOCK_FILES.has(name) || VENDORED.test(path) || GENERATED_DIRS.test(path) || GENERATED_FILES.test(path);
}

/** The depth policy recorded in meta.json, as numbers. */
export const SPLIT = { files: 15, lines: 2000, depth: 3 };

export interface Component {
  path: string;
  files: number;
  lines: number;
}

/**
 * The folders, to depth 3, with more than 15 files or 2k lines (the paths `ignoredPath` drops left out): the ones
 * the depth policy splits into components of their own. The skill counted these with Glob and wc; naming and
 * grouping them stays its work. A file over 2 MB or with a NUL byte in its start counts as a file without lines.
 */
export async function componentsOver(root: string, files: string[]): Promise<Component[]> {
  const by = new Map<string, Component>();
  for (const f of files) {
    if (ignoredPath(f)) continue;
    const lines = await lineCount(join(root, f));
    const parts = f.split("/").slice(0, -1);
    for (let d = 1; d <= Math.min(SPLIT.depth, parts.length); d++) {
      const path = parts.slice(0, d).join("/");
      const c = by.get(path) ?? { path, files: 0, lines: 0 };
      c.files++;
      c.lines += lines;
      by.set(path, c);
    }
  }
  return [...by.values()]
    .filter((c) => c.files > SPLIT.files || c.lines > SPLIT.lines)
    .sort((a, b) => a.path.localeCompare(b.path));
}

async function lineCount(path: string): Promise<number> {
  const h = await open(path, "r").catch(() => null);
  if (!h) return 0;
  try {
    const { size } = await h.stat();
    if (size > 2_000_000) return 0;
    const buf = Buffer.alloc(size);
    await h.read(buf, 0, size, 0);
    if (buf.subarray(0, 8000).includes(0)) return 0;
    let n = 0;
    for (const b of buf) if (b === 10) n++;
    return size > 0 && buf[size - 1] !== 10 ? n + 1 : n;
  } finally {
    await h.close();
  }
}

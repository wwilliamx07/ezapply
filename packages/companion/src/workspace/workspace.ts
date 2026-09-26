import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { z } from "zod";
import { type WorkspaceConfig, WorkspaceConfig as WorkspaceConfigSchema } from "../config/workspace.js";

/** Top-level folders of a workspace. Keep in sync with references/components/workspace.md. */
export const WORKSPACE_DIRS = [
  "profile",
  "templates/resume",
  "templates/cover",
  "library",
  "knowledge",
  "postings",
  "repo-cache",
  ".claude/skills",
] as const;

const WorkspaceState = z.object({
  schemaVersion: z.literal(1),
  activePostingId: z.string().optional(),
});
type WorkspaceState = z.infer<typeof WorkspaceState>;

/** Filesystem access to the user's workspace, with path guards. */
export class Workspace {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  path(...parts: string[]): string {
    return join(this.root, ...parts);
  }

  /**
   * Resolve a user/Claude-supplied path and require that it lives under one of the allowed
   * workspace subfolders. Relative paths are taken relative to the workspace root.
   */
  resolveAllowed(input: string, allowedRoots: readonly string[]): string {
    const abs = resolve(isAbsolute(input) ? input : join(this.root, input));
    for (const r of allowedRoots) {
      const base = this.path(r);
      const rel = relative(base, abs);
      if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return abs;
    }
    throw new EzError(
      ErrorCode.PathNotAllowed,
      `Path is outside the allowed folders: ${input}`,
      `Use a path under ${allowedRoots.map((r) => `${r}/`).join(", ")} in the workspace.`,
    );
  }

  async readConfig(): Promise<WorkspaceConfig> {
    const raw = await readJson(this.path("ezapply.config.json"));
    return WorkspaceConfigSchema.parse(raw ?? { schemaVersion: 1 });
  }

  async readState(): Promise<WorkspaceState> {
    const raw = await readJson(this.path("state.json"));
    return raw ? WorkspaceState.parse(raw) : { schemaVersion: 1 };
  }

  async updateState(patch: Partial<Omit<WorkspaceState, "schemaVersion">>): Promise<WorkspaceState> {
    const next = WorkspaceState.parse({ ...(await this.readState()), ...patch });
    await writeJsonAtomic(this.path("state.json"), next);
    return next;
  }
}

export async function readJson(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Write via temp file + rename so a crash never leaves half-written JSON. */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(data, null, 2)}\n`);
}

export async function writeFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, path);
}

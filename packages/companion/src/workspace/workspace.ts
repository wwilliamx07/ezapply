import { isAbsolute, join, relative, resolve } from "node:path";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { z } from "zod";
import { type WorkspaceConfig, WorkspaceConfig as WorkspaceConfigSchema } from "../config/workspace.js";
import { readJson, writeJsonAtomic } from "../util/fs.js";

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

/** What a derived file was last brought in line with (see freshness/service.ts). */
const Synced = z.object({ hash: z.string(), at: z.string() });

const WorkspaceState = z.object({
  schemaVersion: z.literal(1),
  activePostingId: z.string().optional(),
  synced: z
    .object({
      /** The resume template (main file and content files) the profile was last updated from. */
      resume: Synced.optional(),
      /** The profile's identity, contact and links the cover template's fields were last set from. */
      profileIdentity: Synced.optional(),
      /** LaTeX documents in library/ the user said aren't a template, by workspace path, as they were then. */
      library: z.record(z.string(), Synced).optional(),
    })
    .optional(),
});
export type WorkspaceState = z.infer<typeof WorkspaceState>;

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

  /**
   * Merge a change into state.json. Updates run one at a time: the active posting and the workspace check's
   * baselines are written by different services, and two read-modify-writes at once would lose one.
   */
  updateState(
    patch:
      | Partial<Omit<WorkspaceState, "schemaVersion">>
      | ((s: WorkspaceState) => Partial<Omit<WorkspaceState, "schemaVersion">>),
  ): Promise<WorkspaceState> {
    const next = this.stateWrites.then(async () => {
      const cur = await this.readState();
      const value = WorkspaceState.parse({ ...cur, ...(typeof patch === "function" ? patch(cur) : patch) });
      await writeJsonAtomic(this.path("state.json"), value);
      return value;
    });
    this.stateWrites = next.catch(() => undefined);
    return next;
  }

  private stateWrites: Promise<unknown> = Promise.resolve();
}

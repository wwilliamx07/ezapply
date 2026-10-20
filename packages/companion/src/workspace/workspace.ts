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
  /** What the user put off past the chat they said it in. */
  deferred: z
    .object({
      /** Repos whose new commits aren't checked or asked about until `until`, by `owner/name`. */
      repos: z.record(z.string(), z.object({ until: z.string(), at: z.string() })).optional(),
    })
    .optional(),
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

  /** Merge values into one section of ezapply.config.json, keeping every other value as written. */
  async updateConfig<K extends Exclude<keyof WorkspaceConfig, "schemaVersion">>(
    section: K,
    patch: Partial<WorkspaceConfig[K]>,
  ): Promise<WorkspaceConfig> {
    const path = this.path("ezapply.config.json");
    const raw = ((await readJson(path)) as Record<string, unknown> | null) ?? { schemaVersion: 1 };
    const next = { ...raw, [section]: { ...((raw[section] as Record<string, unknown> | undefined) ?? {}), ...patch } };
    const parsed = WorkspaceConfigSchema.parse(next);
    await writeJsonAtomic(path, next);
    return parsed;
  }

  async readState(): Promise<WorkspaceState> {
    const raw = await readJson(this.path("state.json"));
    return raw ? WorkspaceState.parse(raw) : { schemaVersion: 1 };
  }

  /**
   * Merge a change into state.json. Updates run one at a time: the workspace check's
   * baselines and the repo timers are written by different services, and two read-modify-writes at once would lose one. Repo
   * timers that have run out are dropped on every write.
   */
  updateState(
    patch:
      | Partial<Omit<WorkspaceState, "schemaVersion">>
      | ((s: WorkspaceState) => Partial<Omit<WorkspaceState, "schemaVersion">>),
  ): Promise<WorkspaceState> {
    const next = this.stateWrites.then(async () => {
      const cur = await this.readState();
      const merged = WorkspaceState.parse({ ...cur, ...(typeof patch === "function" ? patch(cur) : patch) });
      const value = {
        ...merged,
        deferred: keepDeferredRepos(merged.deferred, (_, t) => Date.parse(t.until) > Date.now()),
      };
      await writeJsonAtomic(this.path("state.json"), value);
      return value;
    });
    this.stateWrites = next.catch(() => undefined);
    return next;
  }

  /** Drop the repo timers `drop` picks (re-indexed, or no longer selected). Writes nothing when none match. */
  async dropDeferredRepos(drop: (repo: string) => boolean): Promise<void> {
    const timers = (await this.readState()).deferred?.repos ?? {};
    if (!Object.keys(timers).some(drop)) return;
    await this.updateState((s) => ({ deferred: keepDeferredRepos(s.deferred, (repo) => !drop(repo)) }));
  }

  private stateWrites: Promise<unknown> = Promise.resolve();
}

type Deferred = NonNullable<WorkspaceState["deferred"]>;
type RepoTimer = NonNullable<Deferred["repos"]>[string];

/** `deferred` with only the repo timers `keep` picks; undefined once nothing is left in it. */
function keepDeferredRepos(
  deferred: Deferred | undefined,
  keep: (repo: string, t: RepoTimer) => boolean,
): Deferred | undefined {
  if (!deferred?.repos) return deferred;
  const { repos, ...others } = deferred;
  const kept = Object.fromEntries(Object.entries(repos).filter(([repo, t]) => keep(repo, t)));
  if (Object.keys(kept).length) return { ...others, repos: kept };
  return Object.keys(others).length ? others : undefined;
}

import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ErrorCode, EzError } from "@ezapply/protocol";
import type { Logger } from "../logger.js";
import type { ProfileService } from "../profile/service.js";
import type { RepoService } from "../repos/service.js";
import { inScratchpad, type TemplateKind, type TemplateService } from "../templates/service.js";
import { hashFiles, hashValue } from "../util/hash.js";
import { unifiedDiff } from "../util/line-diff.js";
import type { Workspace } from "../workspace/workspace.js";

export type ChangeKind =
  | "repo-pushed"
  | "repo-deselected"
  | "template-source"
  | "template-untracked"
  | "library-template"
  | "resume-edited"
  | "profile-identity";

/** Something derived in the workspace that its source has moved past. */
export interface WorkspaceChange {
  /** Names the exact state (`repo-pushed:owner/name@<sha>`): a change put off and then changed again is new. */
  id: string;
  kind: ChangeKind;
  summary: string;
  /** How it's brought current. */
  detail: string;
  /** For `resume-edited`: what changed in the template since the profile was last updated from it. */
  diff?: string;
  /** What the stale part feeds, so the agent can tell whether the request in hand needs it first. */
  affects: ("claims" | "resume" | "cover" | "profile" | "forms")[];
}

export interface NotChecked {
  /** `owner/name`, or `templates/<kind>` for a template's source folder. */
  what: string;
  reason: string;
  hint?: string;
}

export interface ChangesResult {
  changes: WorkspaceChange[];
  notChecked?: NotChecked[];
  /** The repo check was still running when the wait ran out: call again with `refresh: false` later. */
  pending?: true;
}

const DIFF_MAX_LINES = 200;
const REPO_CONCURRENCY = 4;

interface Options {
  /** How long `changes` waits for a repo check still running (tests shorten it). */
  waitMs?: number;
  /** Per-repo `ls-remote` timeout. */
  remoteTimeoutMs?: number;
}

/**
 * Finds what's out of date in the workspace: knowledge behind its repo, a template behind the folder it was
 * imported from (or imported from a scratchpad copy nobody edits), a LaTeX document in library/ no template
 * came from, the profile behind the resume template, the cover letter's fields behind the profile, and
 * knowledge from repos no longer selected. The repo check needs the network, so it runs once per chat, in
 * the background from `start()`; the local checks are cheap and run on every call. Nothing here changes
 * the derived files: the agent does that with the user's agreement, then marks the change done.
 */
export class FreshnessService {
  private repoCheck: Promise<{ changes: WorkspaceChange[]; notChecked: NotChecked[] }> | null = null;
  /** Changes the user put off, hidden until the chat ends (this service lives as long as the chat). */
  private readonly later = new Set<string>();
  private readonly waitMs: number;
  private readonly remoteTimeoutMs: number;

  constructor(
    private readonly ws: Workspace,
    private readonly profile: ProfileService,
    private readonly templates: TemplateService,
    private readonly repos: RepoService,
    private readonly log: Logger,
    opts: Options = {},
  ) {
    this.waitMs = opts.waitMs ?? 15_000;
    this.remoteTimeoutMs = opts.remoteTimeoutMs ?? 10_000;
  }

  /** Start the repo check in the background (at companion start). Never throws. */
  start(): void {
    this.runRepoCheck();
  }

  async changes(opts: { refresh?: boolean } = {}): Promise<ChangesResult> {
    if (opts.refresh || !this.repoCheck) this.runRepoCheck();
    const local = await this.localChanges();
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), this.waitMs).unref());
    const remote = await Promise.race([this.repoCheck, timeout]);
    const changes = [...(remote?.changes ?? []), ...local.changes].filter((c) => !this.later.has(c.id));
    const notChecked = [...(remote?.notChecked ?? []), ...local.notChecked];
    return {
      changes,
      ...(notChecked.length ? { notChecked } : {}),
      ...(remote ? {} : { pending: true as const }),
    };
  }

  /**
   * `later` hides a change for the rest of the chat. `done` records that the derived part is current: the
   * template with its source, the profile with the resume template, the cover fields with the profile; for
   * a deselected repo it deletes the repo's knowledge and cache. A repo's new commits are ended by
   * `knowledge_mark_indexed` only, after re-indexing.
   */
  async mark(id: string, as: "done" | "later"): Promise<{ id: string; as: string; removed?: string[] }> {
    const current = [...(await this.localChanges()).changes, ...((await this.repoCheck)?.changes ?? [])];
    const change = current.find((c) => c.id === id);
    if (!change) {
      throw new EzError(
        ErrorCode.NotFound,
        `No current change ${id}.`,
        "It may be done already, or changed again since: call workspace_changes for the current ids.",
      );
    }
    if (as === "later") {
      this.later.add(id);
      return { id, as };
    }
    const rest = id.slice(id.indexOf(":") + 1);
    switch (change.kind) {
      case "repo-pushed":
        throw new EzError(
          ErrorCode.BadRequest,
          "A repo's new commits are ended by re-indexing it, not by marking.",
          "Run the ezapply-index-repo skill for it (knowledge_mark_indexed ends this change), or mark it `later`.",
        );
      case "repo-deselected": {
        const { removed } = await this.repos.forget(rest);
        return { id, as, removed };
      }
      case "template-source": {
        const [kind, hash] = rest.split("@") as [TemplateKind, string];
        await this.templates.setSourceHash(kind, hash);
        return { id, as };
      }
      case "template-untracked":
        await this.templates.forgetSource(rest as TemplateKind);
        return { id, as };
      case "library-template": {
        const at = rest.lastIndexOf("@");
        const [path, hash] = [rest.slice(0, at), rest.slice(at + 1)];
        const now = new Date().toISOString();
        await this.ws.updateState((s) => ({
          synced: { ...s.synced, library: { ...s.synced?.library, [path]: { hash, at: now } } },
        }));
        return { id, as };
      }
      case "resume-edited":
        await this.recordResume();
        return { id, as };
      case "profile-identity": {
        const hash = await this.identityHash();
        if (hash) await this.recordSynced("profileIdentity", hash);
        return { id, as };
      }
    }
  }

  // ---- repos (network, once per chat) ----------------------------------------------------------

  private runRepoCheck(): void {
    const check = this.checkRepos().catch((err: unknown) => {
      this.log.warn({ err: (err as Error).message }, "repo check failed");
      return { changes: [], notChecked: [] };
    });
    this.repoCheck = check;
  }

  private async checkRepos(): Promise<{ changes: WorkspaceChange[]; notChecked: NotChecked[] }> {
    const sel = await this.profile.repos();
    if (!sel.exists || !sel.valid) return { changes: [], notChecked: [] };
    const selected = sel.value.repos;
    const changes: WorkspaceChange[] = [];
    const notChecked: NotChecked[] = [];

    // Knowledge from repos no longer selected: claims_list still reads every knowledge folder.
    const chosen = new Set(selected.map((r) => r.fullName.toLowerCase()));
    for (const repo of await this.repos.indexedRepos()) {
      if (chosen.has(repo.toLowerCase())) continue;
      changes.push({
        id: `repo-deselected:${repo}`,
        kind: "repo-deselected",
        summary: `knowledge/${repo.replace("/", "__")} is from ${repo}, which is no longer selected; its claims are still in claims_list.`,
        detail:
          "Ask the user: delete that knowledge and the repo's cache (workspace_change_mark as done), or select the repo again (repos_selection_set).",
        affects: ["claims"],
      });
    }

    // New commits since indexing, by `ls-remote` only: nothing is fetched before the user agrees.
    const indexed: { repo: (typeof selected)[number]; sha: string }[] = [];
    for (const repo of selected) {
      const meta = await this.repos.knowledgeMeta(repo.fullName);
      if (meta) indexed.push({ repo, sha: meta.indexedSha });
    }
    const queue = [...indexed];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { repo, sha } = next;
        try {
          const head = await this.repos.remoteHead(repo.fullName, repo.source, this.remoteTimeoutMs);
          if (head && head !== sha) {
            changes.push({
              id: `repo-pushed:${repo.fullName}@${head.slice(0, 7)}`,
              kind: "repo-pushed",
              summary: `${repo.fullName} has new commits since it was indexed (${sha.slice(0, 7)} → ${head.slice(0, 7)}).`,
              detail:
                "Re-index it with the ezapply-index-repo skill (only what changed); knowledge_mark_indexed ends this.",
              affects: ["claims"],
            });
          }
        } catch (err) {
          const e = EzError.from(err);
          notChecked.push({ what: repo.fullName, reason: e.message, ...(e.hint ? { hint: e.hint } : {}) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(REPO_CONCURRENCY, queue.length) }, worker));
    changes.sort((a, b) => a.id.localeCompare(b.id));
    if (changes.length || notChecked.length) {
      this.log.info({ changes: changes.map((c) => c.id), notChecked: notChecked.length }, "repo check");
    }
    return { changes, notChecked };
  }

  // ---- templates and profile (local, every call) -----------------------------------------------

  private async localChanges(): Promise<{ changes: WorkspaceChange[]; notChecked: NotChecked[] }> {
    const changes: WorkspaceChange[] = [];
    const notChecked: NotChecked[] = [];

    const library = await this.templates.libraryDocuments();
    const dismissed = (await this.ws.readState()).synced?.library ?? {};
    const untracked = library.filter((d) => !d.sourceOf && !d.copyOf && dismissed[d.path]?.hash !== d.hash);

    for (const kind of ["resume", "cover"] as const) {
      const meta = await this.templates.templateMeta(kind);
      if (meta?.importedFrom && inScratchpad(meta.importedFrom)) {
        // Claude's own copy: it never changes, so the template-source check would watch nothing.
        const same = library.filter((d) => d.copyOf === kind).map((d) => d.path);
        const hint = same.length
          ? `${same.join(", ")} has the same text, so it's likely theirs. `
          : untracked.length
            ? "A library document listed here may be it. "
            : "";
        changes.push({
          id: `template-untracked:${kind}`,
          kind: "template-untracked",
          summary: `templates/${kind}/ was imported from a copy in a Claude scratchpad (${meta.importedFrom}), so the user's edits to their own file go unnoticed.`,
          detail:
            `${hint}Ask the user which file or folder they edit (outside the workspace, or in library/), then ` +
            `template_import { source, kind: "${kind}", replace: true } from it. If they keep none, mark this done: ` +
            "the copy stops being watched.",
          affects: [kind],
        });
        continue;
      }
      const src = await this.templates.sourceState(kind);
      if (!src) continue;
      if ("unreadable" in src) {
        notChecked.push({ what: `templates/${kind}`, reason: `${src.from}: ${src.unreadable}` });
        continue;
      }
      if (src.recorded === null && src.matchesCopy) {
        // Imported before the hash was recorded, and still the same: record it, nothing to report.
        await this.templates.setSourceHash(kind, src.hash);
        continue;
      }
      if (src.recorded === src.hash) continue;
      changes.push({
        id: `template-source:${kind}@${src.hash}`,
        kind: "template-source",
        summary:
          src.recorded === null
            ? `The ${kind} template's source (${src.from}) differs from the copy in templates/${kind}/.`
            : `The ${kind} template's source (${src.from}) changed since it was imported.`,
        detail:
          `Re-import it with template_import { source, kind: "${kind}", replace: true } after the user agrees (the ` +
          "current copy moves to templates/.old/). If the difference doesn't matter (or is a fix made in the workspace " +
          "copy), mark it done.",
        affects: [kind],
      });
    }

    for (const doc of untracked) {
      changes.push({
        id: `library-template:${doc.path}@${doc.hash}`,
        kind: "library-template",
        summary: `${doc.path} is a LaTeX document that neither template was imported from, and it differs from both.`,
        detail:
          "Ask the user whether it's their resume or cover letter (newer than the one in templates/). If so, " +
          `template_import { source: ${JSON.stringify(doc.pullsIn ? dirname(doc.abs) : doc.abs)}, kind, replace: true }` +
          `${doc.pullsIn ? " (its folder: it \\inputs files beside it)" : ""}; the check then watches it for their ` +
          "edits. If it isn't a template, mark this done: it comes back only if the file changes.",
        affects: ["resume", "cover"],
      });
    }

    const resume = await this.resumeState();
    if (resume) {
      const synced = (await this.ws.readState()).synced?.resume;
      if (!synced) await this.recordResume();
      else if (synced.hash !== resume.hash) {
        changes.push({
          id: `resume-edited@${resume.hash}`,
          kind: "resume-edited",
          summary: "templates/resume/ changed since the profile was last brought in line with it.",
          detail:
            "Update profile/profile.yaml from the diff (add or change only what it shows; ask before dropping an entry), " +
            "run profile_check, then mark it done. A change that doesn't touch the profile is marked done too.",
          diff: await this.resumeDiff(resume.files),
          affects: ["profile", "forms"],
        });
      }
    }

    if (await this.templates.templateMeta("cover")) {
      const hash = await this.identityHash();
      const synced = (await this.ws.readState()).synced?.profileIdentity;
      if (hash && !synced) await this.recordSynced("profileIdentity", hash);
      else if (hash && synced && synced.hash !== hash) {
        changes.push({
          id: `profile-identity@${hash}`,
          kind: "profile-identity",
          summary: "The profile's name, contact or links changed since the cover template's fields were set.",
          detail:
            "Update \\myname and \\mycontact (or the template's equivalent) in templates/cover/ from the profile, compile, " +
            "render, then mark it done.",
          affects: ["cover"],
        });
      }
    }
    return { changes, notChecked };
  }

  /** The resume template's main file and content files, and their hash. */
  private async resumeState(): Promise<{ hash: string; files: string[] } | null> {
    const meta = await this.templates.templateMeta("resume");
    if (!meta) return null;
    const base = meta.main.includes("/") ? meta.main.slice(0, meta.main.lastIndexOf("/") + 1) : "";
    const files = [meta.main, ...(meta.contentFiles ?? []).map((f) => `${base}${f}`)];
    return { hash: await hashFiles(this.ws.path("templates", "resume"), files), files };
  }

  /** Record the resume template as current, keeping a copy of its text in templates/.synced/resume/ to diff. */
  private async recordResume(): Promise<void> {
    const state = await this.resumeState();
    if (!state) return;
    const snap = this.ws.path("templates", ".synced", "resume");
    await rm(snap, { recursive: true, force: true });
    for (const f of state.files) {
      await mkdir(join(snap, f, ".."), { recursive: true });
      await cp(this.ws.path("templates", "resume", f), join(snap, f)).catch(() => undefined);
    }
    await this.recordSynced("resume", state.hash);
  }

  private async resumeDiff(files: string[]): Promise<string> {
    const snap = this.ws.path("templates", ".synced", "resume");
    const parts: string[] = [];
    for (const f of files) {
      const [before, after] = await Promise.all([
        readFile(join(snap, f), "utf8").catch(() => ""),
        readFile(this.ws.path("templates", "resume", f), "utf8").catch(() => ""),
      ]);
      const d = unifiedDiff(before, after, f);
      if (d) parts.push(d);
    }
    const lines = parts.join("\n").split("\n");
    if (lines.length <= DIFF_MAX_LINES) return lines.join("\n");
    return `${lines.slice(0, DIFF_MAX_LINES).join("\n")}\n… (${lines.length - DIFF_MAX_LINES} more lines: compare templates/.synced/resume/ with templates/resume/)`;
  }

  /** What the cover letter's identity fields come from. Null while the profile is missing or invalid. */
  private async identityHash(): Promise<string | null> {
    const p = await this.profile.profile();
    if (!p.exists || !p.valid) return null;
    const { identity, contact, links } = p.value;
    return hashValue({ identity, contact, links });
  }

  private async recordSynced(key: "resume" | "profileIdentity", hash: string): Promise<void> {
    const at = new Date().toISOString();
    await this.ws.updateState((s) => ({ synced: { ...s.synced, [key]: { hash, at } } }));
  }
}

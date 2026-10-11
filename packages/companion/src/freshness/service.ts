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

/** A repo whose new commits the user put off: not checked until `until`. */
export interface DeferredRepo {
  repo: string;
  until: string;
}

export interface ChangesResult {
  changes: WorkspaceChange[];
  notChecked?: NotChecked[];
  /** Repos put off with a timer still running. */
  deferred?: DeferredRepo[];
  /** The repo check was still running when the wait ran out: call again with `refresh: false` later. */
  pending?: true;
}

/** What the network check found: remote heads past the indexed commit, as of the check. */
interface RepoCheck {
  pushed: { fullName: string; indexedSha: string; head: string }[];
  notChecked: NotChecked[];
}

export interface Marked {
  id: string;
  as: "done" | "later";
  /** For `repo-deselected` marked done: what was deleted. */
  removed?: string[];
  /** For `repo-pushed` put off: when the repo is checked again. */
  until?: string;
}

const DIFF_MAX_LINES = 200;
const REPO_CONCURRENCY = 4;
/** How long a repo is put off when the user doesn't say. */
export const DEFER_DEFAULT_HOURS = 24;
/** The longest a repo is put off, so none is silenced for good (deselecting it is how to stop for good). */
export const DEFER_MAX_HOURS = 90 * 24;

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
 * the derived files: the agent does that with the user's agreement, then marks the change done. A repo put
 * off gets a timer in state.json and isn't checked until it runs out; any other change put off is hidden
 * until the chat ends.
 */
export class FreshnessService {
  private repoCheck: Promise<RepoCheck> | null = null;
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
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), this.waitMs).unref());
    const remote = await Promise.race([this.repoCheck, timeout]);
    const current = await this.current(remote);
    const changes = current.changes.filter((c) => !this.later.has(c.id));
    const { notChecked } = current;
    const deferred = [...(await this.deferredRepos()).values()];
    return {
      changes,
      ...(notChecked.length ? { notChecked } : {}),
      ...(deferred.length ? { deferred } : {}),
      ...(remote ? {} : { pending: true as const }),
    };
  }

  private async current(remote: RepoCheck | null) {
    const repos = await this.repoChanges(remote);
    const local = await this.localChanges();
    return {
      changes: [...repos.changes, ...local.changes],
      notChecked: [...repos.notChecked, ...local.notChecked],
    };
  }

  /**
   * `later` puts a repo's new commits off for `hours` (a day by default, at most 90 days), past the end of
   * the chat, and hides any other change for the rest of the chat. `done` records that the derived part is
   * current: the template with its source, the profile with the resume template, the cover fields with the
   * profile; for a deselected repo it deletes the repo's knowledge and cache. A repo's new commits are ended
   * by `knowledge_mark_indexed` only, after re-indexing. Every id is checked before any is marked.
   */
  async mark(ids: string[], as: "done" | "later", hours?: number): Promise<{ marked: Marked[] }> {
    const current = (await this.current(await this.repoCheck)).changes;
    const picked = ids.map((id) => {
      const change = current.find((c) => c.id === id);
      if (!change) {
        throw new EzError(
          ErrorCode.NotFound,
          `No current change ${id}.`,
          "It may be done already, or changed again since: call workspace_changes for the current ids.",
        );
      }
      return change;
    });
    if (as === "done" && picked.some((c) => c.kind === "repo-pushed")) {
      throw new EzError(
        ErrorCode.BadRequest,
        "A repo's new commits are ended by re-indexing it, not by marking.",
        "Run the ezapply-index-repo skill for it (knowledge_mark_indexed ends this change), or mark it `later`.",
      );
    }
    const timed = picked.find((c) => c.kind !== "repo-pushed");
    if (hours !== undefined && (as !== "later" || timed)) {
      throw new EzError(
        ErrorCode.BadRequest,
        `\`hours\` puts off a repo's new commits only${timed ? `; ${timed.id} is a ${timed.kind} change` : ""}.`,
        "Mark the others `later` without hours: a template or profile behind its source feeds the next document, " +
          "so the next chat asks again.",
      );
    }
    const marked: Marked[] = [];
    for (const change of picked) marked.push(await this.markOne(change, as, hours));
    return { marked };
  }

  private async markOne(change: WorkspaceChange, as: "done" | "later", hours?: number): Promise<Marked> {
    const { id } = change;
    const rest = id.slice(id.indexOf(":") + 1);
    if (as === "later" && change.kind === "repo-pushed") {
      const repo = rest.slice(0, rest.lastIndexOf("@"));
      const ms = Math.min(hours ?? DEFER_DEFAULT_HOURS, DEFER_MAX_HOURS) * 3_600_000;
      const at = new Date();
      const until = new Date(at.getTime() + ms).toISOString();
      await this.ws.updateState((s) => ({
        deferred: { ...s.deferred, repos: { ...s.deferred?.repos, [repo]: { until, at: at.toISOString() } } },
      }));
      return { id, as, until };
    }
    if (as === "later") {
      this.later.add(id);
      return { id, as };
    }
    switch (change.kind) {
      case "repo-pushed":
        throw new Error("unreachable: checked in mark()");
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

  // ---- repos (network once per chat, the rest every call) --------------------------------------

  private runRepoCheck(): void {
    const check = this.checkRepos().catch((err: unknown) => {
      this.log.warn({ err: (err as Error).message }, "repo check failed");
      return { pushed: [], notChecked: [] };
    });
    this.repoCheck = check;
  }

  /**
   * New commits since indexing, by `ls-remote` only: nothing is fetched before the user agrees. A repo put
   * off isn't asked at all until its timer runs out.
   */
  private async checkRepos(): Promise<RepoCheck> {
    const sel = await this.profile.repos();
    if (!sel.exists || !sel.valid) return { pushed: [], notChecked: [] };
    const deferred = await this.deferredRepos();
    const queue: { repo: (typeof sel.value.repos)[number]; sha: string }[] = [];
    for (const repo of sel.value.repos) {
      if (deferred.has(repo.fullName.toLowerCase())) continue;
      const meta = await this.repos.knowledgeMeta(repo.fullName);
      if (meta) queue.push({ repo, sha: meta.indexedSha });
    }
    const pushed: RepoCheck["pushed"] = [];
    const notChecked: NotChecked[] = [];
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const { repo, sha } = next;
        try {
          const head = await this.repos.remoteHead(repo.fullName, repo.source, this.remoteTimeoutMs);
          if (head && head !== sha) pushed.push({ fullName: repo.fullName, indexedSha: sha, head });
        } catch (err) {
          const e = EzError.from(err);
          notChecked.push({ what: repo.fullName, reason: e.message, ...(e.hint ? { hint: e.hint } : {}) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(REPO_CONCURRENCY, queue.length) }, worker));
    if (pushed.length || notChecked.length) {
      this.log.info({ pushed: pushed.map((p) => p.fullName), notChecked: notChecked.length }, "repo check");
    }
    return { pushed, notChecked };
  }

  /**
   * The repo changes as of now. Only the remote heads are kept from the check: the selection and the
   * knowledge folders are read again, so a re-index, a deselected repo's knowledge deleted, or a repo
   * selected again ends its change in the same chat instead of being offered again.
   */
  private async repoChanges(
    remote: RepoCheck | null,
  ): Promise<{ changes: WorkspaceChange[]; notChecked: NotChecked[] }> {
    const sel = await this.profile.repos();
    if (!sel.exists || !sel.valid) return { changes: [], notChecked: [] };
    const chosen = new Set(sel.value.repos.map((r) => r.fullName.toLowerCase()));
    const changes: WorkspaceChange[] = [];

    // Knowledge from repos no longer selected: claims_list still reads every knowledge folder.
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

    const deferred = await this.deferredRepos();
    for (const { fullName, indexedSha, head } of remote?.pushed ?? []) {
      if (!chosen.has(fullName.toLowerCase())) continue;
      // Put off since the check ran: hidden for as long as the timer runs.
      if (deferred.has(fullName.toLowerCase())) continue;
      // Indexed again since the check: repo_sync fetched at least the head the check saw, so it's current.
      if ((await this.repos.knowledgeMeta(fullName))?.indexedSha !== indexedSha) continue;
      changes.push({
        id: `repo-pushed:${fullName}@${head.slice(0, 7)}`,
        kind: "repo-pushed",
        summary: `${fullName} has new commits since it was indexed (${indexedSha.slice(0, 7)} → ${head.slice(0, 7)}).`,
        detail: "Re-index it with the ezapply-index-repo skill (only what changed); knowledge_mark_indexed ends this.",
        affects: ["claims"],
      });
    }
    changes.sort((a, b) => a.id.localeCompare(b.id));
    const notChecked = (remote?.notChecked ?? []).filter((n) => chosen.has(n.what.toLowerCase()));
    return { changes, notChecked };
  }

  /** Selected repos with a timer still running, by lowercased name. */
  private async deferredRepos(): Promise<Map<string, DeferredRepo>> {
    const timers = (await this.ws.readState()).deferred?.repos ?? {};
    const sel = await this.profile.repos();
    const chosen = new Set(sel.exists && sel.valid ? sel.value.repos.map((r) => r.fullName.toLowerCase()) : []);
    const now = Date.now();
    const running = new Map<string, DeferredRepo>();
    for (const [repo, { until }] of Object.entries(timers).sort(([a], [b]) => a.localeCompare(b))) {
      if (Date.parse(until) > now && chosen.has(repo.toLowerCase())) running.set(repo.toLowerCase(), { repo, until });
    }
    return running;
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

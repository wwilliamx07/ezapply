import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";
import {
  ErrorCode,
  EzError,
  postingConversation,
  type WorkspaceChangeKind,
  type WorkspaceChangeOutcome,
  type WorkspaceChangeRequest,
  type WorkspaceChanges,
} from "@ezapply/protocol";
import type { Profile } from "../profile/schema.js";
import type { Services } from "../services.js";
import type { TemplateKind } from "../templates/service.js";
import { pickPath } from "../util/dialog.js";
import { writeFileAtomic } from "../util/fs.js";
import type { WorkspaceChange } from "./service.js";

/**
 * Updates run in the order each feeds the next: the templates first, then the cover's fields from the profile, by
 * code; then the agent's tasks, so updating the profile reads a resume imported a moment before.
 */
const ORDER: WorkspaceChangeKind[] = [
  "template-source",
  "template-untracked",
  "library-template",
  "profile-identity",
  "repo-deselected",
  "resume-edited",
  "repo-pushed",
];

/** What a posting's conversation draws on: its documents on templates, profile and claims; its form on the profile. */
const NEEDS: Record<"tailor" | "fill", Set<string>> = {
  tailor: new Set(["claims", "resume", "cover", "profile"]),
  fill: new Set(["profile", "forms"]),
};

const NAME_MACRO = "myname";
const CONTACT_MACRO = "mycontact";

/**
 * The user's side of keeping the workspace current: the changes `FreshnessService` finds, as the panel's card and the
 * setup page show them, and what their buttons do. Code does the mechanical updates (re-importing a template,
 * the default cover letter's name and contact, a deselected repo's knowledge); what needs judgement (the profile from
 * an edited resume, re-indexing a repo, a build that fails) goes to the agent as a task (`OnboardingService.queue`).
 * The user's choice is the consent, so nothing is changed before it and the agent never marks a change itself.
 */
export class WorkspaceUpdates {
  /** The agent's task on a change, by the change's id. */
  private readonly tasks = new Map<string, string>();
  /** Changes whose file dialog is open. */
  private readonly picking = new Set<string>();
  /** What went wrong acting on a change in the background, until it's acted on again. */
  private readonly notes = new Map<string, string>();

  constructor(private readonly s: () => Services) {}

  /** The current changes, marked against the work of `conversation` (a panel conversation's key, or `setup`). */
  async list(conversation: string): Promise<WorkspaceChanges> {
    const r = await this.s().freshness.changes({ conversation, wait: false });
    const part = postingConversation(conversation)?.part;
    const needs = part ? NEEDS[part] : new Set<string>();
    return {
      changes: r.changes.map((c) => ({
        id: c.id,
        kind: c.kind,
        summary: c.summary,
        needed: c.affects.some((a) => needs.has(a)),
        ...(this.working(c.id) ? { working: true } : {}),
        ...(this.notes.has(c.id) ? { note: this.notes.get(c.id) } : {}),
      })),
      ...(r.deferred ? { deferred: r.deferred } : {}),
      ...(r.notChecked ? { notChecked: r.notChecked } : {}),
    };
  }

  /** Act on the user's choice. Every id is checked, and what each needs, before any is acted on. */
  async act(conversation: string, req: WorkspaceChangeRequest): Promise<{ outcomes: WorkspaceChangeOutcome[] }> {
    const s = this.s();
    const picked = await s.freshness.find(req.ids);
    for (const id of req.ids) this.notes.delete(id);
    if (req.action === "later") {
      const { marked } = await s.freshness.mark(req.ids, "later", req.hours, conversation);
      return {
        outcomes: marked.map((m) => ({ id: m.id, outcome: "later", ...(m.until ? { note: `Until ${m.until}` } : {}) })),
      };
    }
    if (req.action === "done") {
      if (picked.some((c) => c.kind === "repo-deselected") && !req.confirm) {
        throw new EzError(ErrorCode.BadRequest, "Deleting a repo's knowledge needs the user's confirmation.");
      }
      const { marked } = await s.freshness.mark(req.ids, "done");
      return {
        outcomes: marked.map((m) => ({
          id: m.id,
          outcome: "done",
          ...(m.removed?.length ? { note: `Deleted ${m.removed.join(", ")}` } : {}),
        })),
      };
    }
    for (const c of picked) {
      if (c.kind === "library-template" && !req.kind) {
        throw new EzError(ErrorCode.BadRequest, `${c.id}: say whether it's the resume or the cover letter (kind).`);
      }
      if (c.kind === "template-untracked" && !req.pick) {
        throw new EzError(ErrorCode.BadRequest, `${c.id}: say whether the user edits a file or a folder (pick).`);
      }
    }
    const ordered = [...picked].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
    const outcomes: WorkspaceChangeOutcome[] = [];
    for (const c of ordered.filter((c) => c.kind !== "repo-pushed")) {
      outcomes.push(
        await this.update(c, req).catch((err) => ({
          id: c.id,
          outcome: "failed" as const,
          note: EzError.from(err).message,
        })),
      );
    }
    // A repo's new commits, all in one task: the agent reads them in parallel.
    const pushed = ordered.filter((c) => c.kind === "repo-pushed" && !this.working(c.id));
    if (pushed.length) {
      const repos = pushed.map((c) => c.id.slice(c.id.indexOf(":") + 1, c.id.lastIndexOf("@")));
      const task = s.onboarding.queue("index-repos", { repos });
      for (const c of pushed) this.tasks.set(c.id, task.id);
    }
    for (const c of ordered.filter((c) => c.kind === "repo-pushed")) outcomes.push({ id: c.id, outcome: "task" });
    s.freshness.touched();
    return { outcomes };
  }

  private async update(c: WorkspaceChange, req: WorkspaceChangeRequest): Promise<WorkspaceChangeOutcome> {
    const s = this.s();
    if (this.working(c.id)) return { id: c.id, outcome: "task" };
    const rest = c.id.slice(c.id.indexOf(":") + 1);
    switch (c.kind) {
      case "template-source": {
        const kind = rest.slice(0, rest.indexOf("@")) as TemplateKind;
        const meta = await s.templates.templateMeta(kind);
        const source = c.source ?? meta?.importedFrom;
        if (!source) throw new EzError(ErrorCode.NotFound, `The ${kind} template's source isn't recorded.`);
        return this.importAndBuild(c.id, kind, source, meta?.main);
      }
      case "template-untracked": {
        // The dialog waits on the user as long as they take, longer than the panel's call may: it runs on its own,
        // and the list says how it went.
        this.picking.add(c.id);
        this.notes.delete(c.id);
        void this.pickAndImport(c.id, rest as TemplateKind, req.pick ?? "folder").finally(() => {
          this.picking.delete(c.id);
          s.freshness.touched();
        });
        return { id: c.id, outcome: "dialog" };
      }
      case "library-template": {
        const kind = req.kind as TemplateKind;
        if (!c.source) throw new EzError(ErrorCode.NotFound, `${c.id} names no file.`);
        return this.importAndBuild(c.id, kind, c.source);
      }
      case "profile-identity":
        return this.coverIdentity(c);
      case "repo-deselected": {
        // Selected again: by the app when it can read it, else as a public repo.
        const sel = await s.profile.repos();
        const repos = sel.exists && sel.valid ? sel.value.repos : [];
        const listed = await s.github.listRepos().catch(() => []);
        const source = listed.some((r) => r.fullName.toLowerCase() === rest.toLowerCase()) ? "app" : "public-url";
        await s.profile.writeRepos({ schemaVersion: 1, repos: [...repos, { fullName: rest, source }] });
        return { id: c.id, outcome: "updated", note: `${rest} is selected again.` };
      }
      case "resume-edited": {
        const task = s.onboarding.queue("update-profile", { diff: c.diff ?? "" }, () =>
          s.freshness.mark([c.id], "done"),
        );
        this.tasks.set(c.id, task.id);
        return { id: c.id, outcome: "task" };
      }
      case "repo-pushed":
        throw new Error("unreachable: queued together in act()");
    }
  }

  /** The system's dialog for the file or folder the user edits, then the import from it. */
  private async pickAndImport(id: string, kind: TemplateKind, pick: "folder" | "tex"): Promise<void> {
    const what = kind === "resume" ? "resume" : "cover letter";
    const picked = await pickPath(
      pick,
      pick === "folder" ? `Choose the folder of the ${what} you edit` : `Choose the .tex file of the ${what} you edit`,
    );
    if ("unavailable" in picked) {
      this.notes.set(id, "This system has no file dialog: import it on the setup page.");
      return;
    }
    if ("cancelled" in picked) return;
    const outcome = await this.importAndBuild(id, kind, picked.path).catch((err) => ({
      outcome: "failed",
      note: EzError.from(err).message,
    }));
    if (outcome.outcome === "failed" && outcome.note) this.notes.set(id, outcome.note);
  }

  /**
   * Import a template (replacing the current one, kept in templates/.old/) and build it. A build that fails goes
   * to the agent, with the copy it replaced, which may hold the fix the environment needs.
   */
  private async importAndBuild(
    id: string,
    kind: TemplateKind,
    source: string,
    main?: string,
  ): Promise<WorkspaceChangeOutcome> {
    const s = this.s();
    const imported = await s.templates.importTemplate({ source, kind, ...(main ? { main } : {}), replace: true });
    const built = await s.documents.compile(imported.main);
    if (built.ok) return { id, outcome: "updated" };
    const error = built.diagnostics.find((d) => d.severity === "error")?.message ?? built.hint ?? "The build failed.";
    const task = s.onboarding.queue("fix-template-build", {
      kind,
      main: this.rel(imported.main),
      ...(imported.previous ? { previous: this.rel(imported.previous) } : {}),
    });
    this.tasks.set(id, task.id);
    return { id, outcome: "task", note: error };
  }

  /**
   * The cover letter's name and contact from the profile, written into the template (not built). ezapply's letter
   * holds them in two macros, set here, and so does one restyled from it; a template the user imported may lay them
   * out its own way, so it's left alone (`filled: false`) for the agent. Records the profile's identity as matched.
   */
  async fillCoverIdentity(): Promise<{ filled: boolean; main: string }> {
    const s = this.s();
    const [meta, main, profile] = await Promise.all([
      s.templates.templateMeta("cover"),
      s.templates.templateMain("cover"),
      s.profile.profile(),
    ]);
    if (!main) throw new EzError(ErrorCode.NotFound, "There's no cover letter template.");
    if (!profile.exists || !profile.valid) {
      throw new EzError(ErrorCode.BadRequest, "The profile isn't valid.", "Fix the profile step first.");
    }
    const tex = await readFile(main, "utf8");
    const filled =
      meta?.origin === "imported"
        ? null
        : setMacro(setMacro(tex, NAME_MACRO, coverName(profile.value)), CONTACT_MACRO, coverContact(profile.value));
    if (filled === null) return { filled: false, main };
    await writeFileAtomic(main, filled);
    await s.freshness.recordProfileIdentity();
    return { filled: true, main };
  }

  private async coverIdentity(c: WorkspaceChange): Promise<WorkspaceChangeOutcome> {
    const s = this.s();
    const { filled, main } = await this.fillCoverIdentity();
    if (!filled) {
      const task = s.onboarding.queue("fill-cover-identity", { path: this.rel(main) }, () =>
        s.freshness.mark([c.id], "done"),
      );
      this.tasks.set(c.id, task.id);
      return { id: c.id, outcome: "task" };
    }
    const built = await s.documents.compile(main);
    if (built.ok) return { id: c.id, outcome: "updated" };
    return { id: c.id, outcome: "failed", note: built.diagnostics.find((d) => d.severity === "error")?.message };
  }

  private working(changeId: string): boolean {
    if (this.picking.has(changeId)) return true;
    const id = this.tasks.get(changeId);
    const status = id ? this.s().onboarding.task(id)?.status : undefined;
    return status === "queued" || status === "running";
  }

  private rel(abs: string): string {
    return relative(this.s().workspace.root, abs).split(sep).join("/");
  }
}

/** The name the letter is signed with. */
export function coverName(p: Profile): string {
  return texEscape(`${p.identity.preferredName ?? p.identity.firstName} ${p.identity.lastName}`);
}

/** The letter's contact line, as ezapply's default template lays it out: place, email, phone, links. */
export function coverContact(p: Profile): string {
  const place = [p.contact.address.city, p.contact.address.region].filter(Boolean).join(", ");
  const links = [p.links.linkedin, p.links.github, p.links.portfolio]
    .filter((u): u is string => Boolean(u))
    .map((u) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""));
  return [place, p.contact.email, p.contact.phone?.number, ...links]
    .filter((v): v is string => Boolean(v))
    .map(texEscape)
    .join(" \\quad\\textbar\\quad ");
}

/** `\newcommand{\<name>}{…}` with a new body; null when the file doesn't define it. Braces in the body are matched. */
export function setMacro(tex: string | null, name: string, body: string): string | null {
  if (tex === null) return null;
  const head = `\\newcommand{\\${name}}{`;
  const start = tex.indexOf(head);
  if (start < 0) return null;
  let depth = 1;
  let i = start + head.length;
  for (; i < tex.length && depth > 0; i++) {
    if (tex[i] === "\\") i++;
    else if (tex[i] === "{") depth++;
    else if (tex[i] === "}") depth--;
  }
  if (depth !== 0) return null;
  return `${tex.slice(0, start + head.length)}${body}${tex.slice(i - 1)}`;
}

function texEscape(s: string): string {
  return s.replace(/[\\&%$#_{}~^]/g, (ch) =>
    ch === "\\"
      ? "\\textbackslash{}"
      : ch === "~"
        ? "\\textasciitilde{}"
        : ch === "^"
          ? "\\textasciicircum{}"
          : `\\${ch}`,
  );
}

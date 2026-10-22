import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, extname, join, relative, sep } from "node:path";
import {
  ErrorCode,
  EzError,
  GENERAL_CONVERSATION,
  type OnboardPreferences,
  type OnboardRepo,
  type OnboardState,
  type OnboardStep,
  type OnboardStepId,
  type OnboardTask,
  type OnboardTaskKind,
} from "@ezapply/protocol";
import { z } from "zod";
import { extensionFolders, startPairing } from "../bridge/pairing.js";
import type { RepoInfo } from "../github/service.js";
import type { Services } from "../services.js";
import { workspaceStatus } from "../status.js";
import {
  EventStreams,
  pageCookie,
  presentedToken,
  readJsonBody,
  sameOrigin,
  sendJson,
  tokenOk,
} from "../ui/session.js";
import { pickPath } from "../util/dialog.js";
import { exists } from "../util/fs.js";
import { htmlPage } from "../util/html.js";
import { installCommand } from "../util/install-hints.js";

const BASE = "/onboard";
/** How often the open page's state is compared, to tell it what changed (a login, a repo indexed). */
const WATCH_MS = 2000;
const LIBRARY_MAX_BYTES = 25 * 1024 * 1024;
const LIBRARY_TYPES = new Set([".pdf", ".docx", ".doc", ".png", ".jpg", ".jpeg", ".webp", ".txt", ".md", ".tex"]);

/** workspace_check's items, as the page's steps. */
const STEPS: [string, OnboardStepId][] = [
  ["tex", "tex"],
  ["extension", "extension"],
  ["github_login", "github"],
  ["repos_selected", "repos"],
  ["knowledge_indexed", "knowledge"],
  ["resume_template", "resume"],
  ["profile", "profile"],
  ["cover_template", "cover"],
  ["answer_bank", "answers"],
  ["preferences", "preferences"],
  ["library", "library"],
];

/**
 * What the agent is told to do with each kind of task. It comes back with the task, so the skill needs no
 * copy of it and stays the same when a kind is added.
 */
const HOW: Record<OnboardTaskKind, string> = {
  "install-tex":
    "Say in one line what this installs and roughly how big it is, then run params.command with your shell tool " +
    "(it can take several minutes; the user approves it). workspace_check confirms it.",
  "index-repos":
    "Run the ezapply-index-repo skill for each repo in params.repos, in parallel subagents when there are more than " +
    "two. Each ends with knowledge_mark_indexed, which the page shows as it happens.",
  "fix-template-build":
    "tex_compile { path: params.main }. Fix only what the environment needs (a font path, a `% !TEX program` line), " +
    "never the content. Say what you changed in note.",
  "draft-profile":
    "Read the resume template's source (params.main and its content files) and write profile/profile.yaml: identity, " +
    "contact, links, work (YYYY-MM dates, end: null for the current role), education, skills, languages, " +
    "certifications. Write only what the resume says; the user fills the rest on the page. profile_check until valid.",
  "fill-cover-identity":
    "Set the cover template's \\myname and \\mycontact from profile/profile.yaml, then tex_compile { path } it.",
  "restyle-cover":
    "Restyle the cover template to match the resume's fonts and header (the ezapply-cover-letter skill), then " +
    "tex_compile { path } it.",
  "cover-from-example":
    "params.file is in the workspace (library/…): template_import_example { sourcePath } with its absolute path, " +
    "then follow Build from an example in the ezapply-cover-letter skill.",
  "revise-cover": "Change the cover template as params.request says, then tex_compile { path } it.",
  question: "Answer params.text in a few sentences in note: the page shows it to the user.",
};

const TaskBody = z.object({
  action: z.literal("task"),
  kind: z.enum(Object.keys(HOW) as [OnboardTaskKind, ...OnboardTaskKind[]]),
  params: z.record(z.string(), z.unknown()).default({}),
});
const Action = z.discriminatedUnion("action", [
  TaskBody,
  z.object({ action: z.literal("pair"), replace: z.boolean().optional() }),
  z.object({ action: z.literal("github"), app: z.enum(["new", "existing"]).optional() }),
  z.object({ action: z.literal("repos"), repos: z.array(z.string().regex(/^[\w.-]+\/[\w.-]+$/)).max(500) }),
  z.object({ action: z.literal("addRepo"), url: z.string().min(1).max(500) }),
  z.object({ action: z.literal("browse"), kind: z.enum(["folder", "tex"]), title: z.string().max(200).optional() }),
  z.object({
    action: z.literal("import"),
    kind: z.enum(["resume", "cover"]),
    source: z.string().min(1).max(1000),
    main: z.string().max(500).optional(),
    replace: z.boolean().optional(),
  }),
  z.object({ action: z.literal("compile"), kind: z.enum(["resume", "cover"]) }),
  z.object({ action: z.literal("profile"), value: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.literal("answers"), answers: z.record(z.string(), z.string().max(4000).nullable()) }),
  z.object({
    action: z.literal("preferences"),
    attachMode: z.enum(["after-approval", "immediately"]),
    tone: z.string().max(4000),
    emphasis: z.string().max(4000),
    neverMention: z.string().max(4000),
    targets: z.string().max(4000),
    coverLetters: z.string().max(4000),
  }),
  z.object({ action: z.literal("notifications"), turnEnd: z.boolean() }),
  z.object({ action: z.literal("deleteLibrary"), name: z.string().min(1).max(500) }),
  z.object({ action: z.literal("finish") }),
]);
type Action = z.infer<typeof Action>;

/** What `onboarding` gives the agent. */
type OnboardingNext =
  | { task: OnboardTask & { how: string } }
  | { done: true; ready: boolean; notDone: string[] }
  | { waiting: true };

/**
 * Onboarding on a page (the UI package's onboard page): the workspace_check list as steps the user works through
 * in the browser, where most of them are form-filling. What needs judgment or a shell goes to the agent as a
 * task. Under `ezapply` (the side panel's agent, agent/service.ts) a task is a message to the general
 * conversation, and the agent reports it with `onboarding { taskId, result, wait: false }`; a turn that ends unreported fails it (`followAgent`). Without a panel
 * agent (tests), Claude sits in a blocking `onboarding` call, takes the next task and reports. Either way the user approves its commands.
 */
export class OnboardingService {
  private token: string | null = null;
  private finished = false;
  private readonly tasks: OnboardTask[] = [];
  private readonly waiters = new Set<() => void>();
  private listening = 0;
  private readonly events = new EventStreams();
  private watcher: NodeJS.Timeout | null = null;
  private fingerprint = "";
  /** Tasks sent to the panel's agent, by the message that carried them, until it takes the message. */
  private readonly carrying = new Map<string, OnboardTask>();
  /** Tasks in the general conversation's running turn. */
  private readonly inTurn = new Set<OnboardTask>();
  /** Tasks sent to the panel's agent and not ended yet. */
  private readonly sent = new Set<OnboardTask>();
  private followingAgent = false;

  constructor(
    private readonly services: () => Services,
    private readonly localBaseUrl: () => string,
  ) {}

  /**
   * The page's URL; a new link the first time, the same one after. Asking again reopens a finished page. With a
   * step, the link opens there (its hash), and a page already open moves to it.
   */
  open(step?: OnboardStepId): { url: string; pageOpen: boolean } {
    this.token ??= randomBytes(24).toString("base64url");
    this.finished = false;
    const pageOpen = this.events.count() > 0;
    if (pageOpen) this.changed();
    if (pageOpen && step) this.events.send("step", { step });
    return { url: `${this.localBaseUrl()}${BASE}?t=${this.token}${step ? `#${step}` : ""}`, pageOpen };
  }

  /**
   * The agent's side: the next task (taken and marked running), or done once the user finishes, waiting up to
   * `timeoutMs`. A task taken but never reported is given again, in case the agent lost track of it.
   */
  async next(timeoutMs: number): Promise<OnboardingNext> {
    const take = async (): Promise<OnboardingNext | null> => {
      if (this.finished) return this.doneSummary();
      const running = this.tasks.find((t) => t.status === "running");
      const task = running ?? this.tasks.find((t) => t.status === "queued");
      if (!task) return null;
      task.status = "running";
      this.changed();
      return { task: { ...task, how: HOW[task.kind] } };
    };
    const now = await take();
    if (now) return now;
    this.listening++;
    this.changed();
    try {
      await new Promise<void>((resolve) => {
        const wake = () => {
          clearTimeout(timer);
          this.waiters.delete(wake);
          resolve();
        };
        const timer = setTimeout(wake, timeoutMs);
        this.waiters.add(wake);
      });
    } finally {
      this.listening--;
      this.changed();
    }
    return (await take()) ?? { waiting: true };
  }

  /** The agent finished a task. */
  report(taskId: string, result: { ok: boolean; note?: string }): void {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) {
      throw new EzError(ErrorCode.NotFound, `No onboarding task ${taskId}.`, "The setup page lists the current tasks.");
    }
    task.status = result.ok ? "done" : "failed";
    if (result.note) task.note = result.note.slice(0, 4000);
    this.changed();
  }

  // ---- the page ----------------------------------------------------------------------------------

  async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const part = url.pathname === BASE ? "" : url.pathname.slice(BASE.length + 1);
    if (!this.token || !tokenOk(presentedToken(req, url), this.token)) {
      if (part) return sendJson(res, 404, { error: "not found" });
      return htmlPage(
        res,
        404,
        "Setup page not found",
        "<p>This link is wrong or from an earlier chat. Ask Claude to set you up again.</p>",
      );
    }
    const s = this.services();
    try {
      if (!part && req.method === "GET") {
        if (url.searchParams.has("t")) res.setHeader("Set-Cookie", pageCookie(this.token, BASE));
        return s.ui.page(res, "onboard", "ezapply: Set up", BASE);
      }
      if (req.method === "GET") {
        if (part === "state") return sendJson(res, 200, await this.state());
        if (part === "events") {
          this.events.add(req, res);
          this.startWatching();
          return;
        }
        if (part === "repos") return sendJson(res, 200, await this.repos());
        if (part === "file") return await this.file(res, url.searchParams.get("path") ?? "");
      }
      if (req.method === "POST" && (part === "action" || part === "library")) {
        if (!sameOrigin(req)) return sendJson(res, 403, { error: "forbidden origin" });
        if (part === "library") return sendJson(res, 200, await this.library(req, url.searchParams.get("name") ?? ""));
        const body = Action.safeParse(await readJsonBody(req));
        if (!body.success) return sendJson(res, 400, { error: "That request isn't one this page makes." });
        const out = await this.act(body.data);
        this.changed();
        return sendJson(res, 200, out);
      }
      return sendJson(res, 404, { error: "not found" });
    } catch (err) {
      const e = err instanceof EzError ? err : null;
      s.log.warn({ err: (err as Error).message, part }, "onboarding: request failed");
      return sendJson(res, 400, { error: (err as Error).message, ...(e?.hint ? { hint: e.hint } : {}) });
    }
  }

  private async act(a: Action): Promise<unknown> {
    const s = this.services();
    switch (a.action) {
      case "task": {
        const task: OnboardTask = {
          id: `t${this.tasks.length + 1}`,
          kind: a.kind,
          params: a.params,
          status: "queued",
          createdAt: new Date().toISOString(),
        };
        this.tasks.push(task);
        if (s.agent.available) this.dispatch(task);
        else for (const w of this.waiters) w();
        return { task };
      }
      case "pair": {
        const p = await startPairing(s, a.replace);
        return { connected: p.connected, built: p.built };
      }
      case "github":
        return { url: s.github.loginUrl(a.app) };
      case "repos": {
        // Repos added by URL keep how they were added; the rest come through the app.
        const sel = await s.profile.repos();
        const before = new Map(sel.exists && sel.valid ? sel.value.repos.map((r) => [r.fullName, r]) : []);
        const repos = a.repos.map((fullName) => before.get(fullName) ?? { fullName, source: "app" as const });
        await s.profile.writeRepos({ schemaVersion: 1, repos });
        return { selected: repos.map((r) => r.fullName) };
      }
      case "addRepo":
        return this.addRepo(a.url);
      case "browse":
        return pickPath(a.kind, a.title ?? (a.kind === "folder" ? "Choose the folder" : "Choose the .tex file"));
      case "import": {
        const imported = await s.templates.importTemplate({
          source: a.source,
          kind: a.kind,
          ...(a.main ? { main: a.main } : {}),
          ...(a.replace ? { replace: a.replace } : {}),
        });
        return { imported, compile: await this.compile(a.kind) };
      }
      case "compile":
        return { compile: await this.compile(a.kind) };
      case "profile":
        return s.profile.saveProfile(a.value);
      case "answers":
        return s.profile.saveAnswers(a.answers);
      case "preferences": {
        const { action: _, attachMode, ...prefs } = a;
        await s.reviews.setAttachMode(attachMode);
        await s.profile.savePreferences(prefs);
        return { ok: true };
      }
      case "notifications": {
        const config = await s.workspace.updateConfig("notifications", { turnEnd: a.turnEnd });
        return { notifications: config.notifications };
      }
      case "deleteLibrary":
        return this.deleteLibrary(a.name);
      case "finish":
        this.finished = true;
        for (const w of this.waiters) w();
        return { finished: true };
    }
  }

  /**
   * Hand a task to the panel's agent, as a message to the general conversation, which runs beside any other. A send
   * that fails (no agent) fails the task with why; the page offers it again.
   */
  private dispatch(task: OnboardTask): void {
    const s = this.services();
    this.followAgent();
    task.status = "running";
    const message =
      `Setup task ${task.id} from the setup page (${task.kind}). ${HOW[task.kind]}\n` +
      `Parameters: ${JSON.stringify(task.params)}\n` +
      `When it's done, report it: onboarding { taskId: "${task.id}", result: { ok, note? } }.`;
    s.agent.send(GENERAL_CONVERSATION, message).then(
      ({ id }) => {
        this.carrying.set(id, task);
        this.sent.add(task);
        this.endIfIdle();
      },
      (err: Error) => {
        task.status = "failed";
        task.note = err.message;
        this.changed();
      },
    );
  }

  /**
   * A dispatched task whose turn ends unreported (the user pressed Stop, the turn failed, the agent ended it or exited)
   * fails, saying why, so the page offers it again instead of spinning. A report that comes later still counts.
   */
  private followAgent(): void {
    if (this.followingAgent) return;
    this.followingAgent = true;
    const s = this.services();
    s.agent.onEvent((conversation, event) => {
      if (conversation !== GENERAL_CONVERSATION) return;
      if (event.kind === "user" && event.taken) {
        const task = this.carrying.get(event.id);
        if (task) {
          this.carrying.delete(event.id);
          this.inTurn.add(task);
        }
      } else if (event.kind === "turnEnd") {
        for (const task of this.inTurn) this.end(task, event);
        this.inTurn.clear();
        this.endIfIdle(event);
      }
    });
    s.agent.onState(() => this.endIfIdle());
  }

  /** Once the general conversation does nothing, no task sent to it is still being worked on. */
  private endIfIdle(event?: { ok: boolean; interrupted?: boolean }): void {
    const status = this.services().agent.statusOf(GENERAL_CONVERSATION);
    if (status === "working" || status === "starting") return;
    for (const task of this.sent) this.end(task, event);
  }

  private end(task: OnboardTask, event?: { ok: boolean; interrupted?: boolean }): void {
    this.sent.delete(task);
    for (const [id, t] of this.carrying) if (t === task) this.carrying.delete(id);
    if (task.status !== "running") return;
    const name = this.services().agent.agentName(GENERAL_CONVERSATION);
    task.status = "failed";
    task.note = event?.interrupted
      ? "Stopped before it finished. Ask again to retry."
      : event?.ok === false
        ? `${name} stopped with an error: see the ezapply panel. Ask again to retry.`
        : `${name} ended without finishing this: see its reply in the ezapply panel.`;
    this.changed();
  }

  /** Build a template's main file, for the page to show (and say what went wrong). */
  private async compile(kind: "resume" | "cover") {
    const s = this.services();
    const main = await s.templates.templateMain(kind);
    if (!main) return { ok: false, hint: "No template yet." };
    const r = await s.documents.compile(main);
    return {
      ok: r.ok,
      ...(r.pdf ? { pdf: this.rel(r.pdf) } : {}),
      ...(r.pages !== undefined ? { pages: r.pages } : {}),
      ...(r.pageLimit !== undefined ? { pageLimit: r.pageLimit } : {}),
      errors: r.diagnostics
        .filter((d) => d.severity === "error")
        .slice(0, 5)
        .map((d) => d.message),
      ...(r.hint ? { hint: r.hint } : {}),
      main: this.rel(main),
    };
  }

  /** A template's built PDF, for the page's viewer. Only PDFs under templates/. */
  private async file(res: ServerResponse, path: string): Promise<void> {
    const s = this.services();
    const abs = s.workspace.resolveAllowed(path, ["templates"]);
    if (extname(abs).toLowerCase() !== ".pdf") return sendJson(res, 404, { error: "not found" });
    const bytes = await readFile(abs).catch(() => null);
    if (!bytes) return sendJson(res, 404, { error: "not found" });
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Length": bytes.byteLength,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(bytes);
  }

  /** A file dropped on the library step: saved into library/ under its own name (never over another file). */
  private async library(req: IncomingMessage, name: string): Promise<{ saved: string }> {
    const s = this.services();
    // The name only: no folders, no characters Windows refuses, nothing below a space.
    const clean = [...basename(name.replace(/\\/g, "/"))]
      .filter((c) => c.charCodeAt(0) >= 0x20 && !'<>:"|?*'.includes(c))
      .join("")
      .trim();
    const ext = extname(clean).toLowerCase();
    if (!clean || !LIBRARY_TYPES.has(ext)) {
      throw new EzError(
        ErrorCode.BadRequest,
        `ezapply keeps PDFs, Word files, images, text and LaTeX in library/, not ${ext || "this"}.`,
      );
    }
    const tooBig = () => new EzError(ErrorCode.BadRequest, "Files go into library/ up to 25 MB.");
    const length = Number(req.headers["content-length"] ?? "0");
    if (!length || length > LIBRARY_MAX_BYTES) throw tooBig();
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > LIBRARY_MAX_BYTES) throw tooBig();
      chunks.push(chunk);
    }
    const dir = s.workspace.path("library");
    await mkdir(dir, { recursive: true });
    const stem = clean.slice(0, clean.length - ext.length);
    let target = join(dir, clean);
    for (let n = 2; await exists(target); n++) target = join(dir, `${stem}-${n}${ext}`);
    await writeFile(target, Buffer.concat(chunks), { flag: "wx" });
    return { saved: this.rel(target) };
  }

  /**
   * Delete a file from library/ for good: only one the library step lists (a file directly in library/, by its exact
   * name), so no name reaches outside it.
   */
  private async deleteLibrary(name: string): Promise<{ deleted: string }> {
    const s = this.services();
    if (!(await s.profile.libraryFiles()).includes(name)) {
      throw new EzError(ErrorCode.NotFound, `There's no ${name} in your library.`);
    }
    const target = s.workspace.path("library", name);
    if (!(await stat(target)).isFile()) throw new EzError(ErrorCode.BadRequest, `${name} isn't a file.`);
    await rm(target);
    return { deleted: `library/${name}` };
  }

  /**
   * Select a public repo the app can't see (one the user contributed to but doesn't own), by its URL or
   * `owner/name`. It's read without the app's token, so it must answer anonymously; one the app lists is ticked
   * in the list instead, where it keeps the app's access.
   */
  private async addRepo(input: string): Promise<{ added: string }> {
    const s = this.services();
    const fullName = repoFromUrl(input);
    if (!fullName) {
      throw new EzError(
        ErrorCode.BadRequest,
        `${input.slice(0, 100)} isn't a GitHub repository's address.`,
        "Paste it as https://github.com/owner/name.",
      );
    }
    const sel = await s.profile.repos();
    const repos = sel.exists && sel.valid ? sel.value.repos : [];
    const same = (r: { fullName: string }) => r.fullName.toLowerCase() === fullName.toLowerCase();
    const already = repos.find(same);
    if (already) return { added: already.fullName };
    const listed = (await s.github.listRepos().catch(() => [])).find(same);
    if (listed) {
      throw new EzError(
        ErrorCode.BadRequest,
        `${listed.fullName} is one the GitHub App can read already.`,
        "Tick it in the list above.",
      );
    }
    try {
      await s.repos.remoteHead(fullName, "public-url");
    } catch {
      throw new EzError(
        ErrorCode.NotFound,
        `${fullName} couldn't be read as a public repository.`,
        "Check the address. A private repository is added by giving the GitHub App access to it.",
      );
    }
    await s.profile.writeRepos({ schemaVersion: 1, repos: [...repos, { fullName, source: "public-url" }] });
    return { added: fullName };
  }

  /**
   * The repos the app can read, with which to suggest when nothing is selected yet, then the ones added by URL
   * (so saving the list keeps them).
   */
  private async repos(): Promise<OnboardRepo[]> {
    const s = this.services();
    const [list, sel, gh] = await Promise.all([s.github.listRepos(), s.profile.repos(), s.github.status()]);
    const selected = new Set(sel.exists && sel.valid ? sel.value.repos.map((r) => r.fullName) : []);
    const byUrl: OnboardRepo[] = (sel.exists && sel.valid ? sel.value.repos : [])
      .filter((r) => r.source === "public-url")
      .map((r) => ({
        fullName: r.fullName,
        source: "public-url",
        private: false,
        fork: false,
        archived: false,
        language: null,
        sizeKb: 0,
        pushedAt: null,
        description: null,
        stars: 0,
        selected: true,
        suggested: false,
      }));
    const fromApp = list.map((r) => {
      const reason = skipReason(r, gh.login);
      return {
        fullName: r.fullName,
        private: r.private,
        fork: r.fork,
        archived: r.archived,
        language: r.language,
        sizeKb: r.sizeKb,
        pushedAt: r.pushedAt,
        description: r.description,
        stars: r.stars,
        selected: selected.has(r.fullName),
        suggested: !reason,
        ...(reason ? { skipReason: reason } : {}),
      };
    });
    const listed = new Set(list.map((r) => r.fullName));
    return [...fromApp, ...byUrl.filter((r) => !listed.has(r.fullName))];
  }

  async state(): Promise<OnboardState> {
    const s = this.services();
    const check = await workspaceStatus(s);
    const item = (name: string) => check.items.find((i) => i.step === name);
    const steps: OnboardStep[] = STEPS.map(([name, id]) => {
      const i = item(name);
      return { id, done: i?.done ?? false, required: i?.required ?? false, detail: i?.detail ?? "" };
    });
    const agent = item("agent_file");
    const bridge = s.bridge.status();
    const folders = extensionFolders(s);
    const gh = await s.github.status();
    const sel = await s.profile.repos();
    const selected = sel.exists && sel.valid ? sel.value.repos.map((r) => r.fullName) : [];
    const indexed: Record<string, string | null> = {};
    for (const r of selected) indexed[r] = (await s.repos.knowledgeMeta(r))?.indexedAt ?? null;
    const resumeMeta = await s.templates.templateMeta("resume");
    const coverMeta = await s.templates.templateMeta("cover");
    const profile = await s.profile.checkProfile();
    const answers = await s.profile.checkAnswers();
    const prefs = await s.profile.preferences();
    return {
      status: this.finished ? "finished" : "open",
      ready: check.ready,
      agentFile: { done: agent?.done ?? false, detail: agent?.detail ?? "" },
      steps,
      tasks: this.tasks,
      agentListening: s.agent.available ? s.agent.state().status !== "unavailable" : this.listening > 0,
      agentIn: s.agent.available ? "panel" : "terminal",
      agentName: s.agent.available ? s.agent.agentName(GENERAL_CONVERSATION) : "Claude Code",
      tex: {
        done: item("tex")?.done ?? false,
        detail: item("tex")?.detail ?? "",
        installCommand: installCommand("tex"),
      },
      extension: {
        connected: bridge.connected,
        paired: bridge.paired,
        ...(bridge.browser ? { browser: bridge.browser.name } : {}),
        pairingOpen: s.bridge.pairingStatus().openUntil !== undefined,
        built: folders.built,
        ...(folders.chrome ? { chromeFolder: folders.chrome } : {}),
      },
      github: {
        appRegistered: gh.appRegistered,
        loggedIn: gh.loggedIn,
        ...(gh.login ? { login: gh.login } : {}),
        ...(gh.manageUrl ? { manageUrl: gh.manageUrl } : {}),
        ...(gh.portMismatch ? { problem: gh.portMismatch.hint } : {}),
      },
      repos: { selected, indexed },
      resume: {
        ...(resumeMeta ? { main: `templates/resume/${resumeMeta.main}` } : {}),
        ...(resumeMeta?.importedFrom ? { source: resumeMeta.importedFrom } : {}),
        ...(await this.builtPdf("resume", resumeMeta?.main)),
      },
      cover: {
        ...(coverMeta ? { main: `templates/cover/${coverMeta.main}` } : {}),
        isDefault: coverMeta?.origin === "default",
        ...(coverMeta?.example ? { example: coverMeta.example } : {}),
        ...(await this.builtPdf("cover", coverMeta?.main)),
      },
      profile: {
        exists: profile.exists,
        valid: profile.exists ? profile.valid === true : false,
        ...(profile.exists ? { value: await s.profile.rawProfile() } : {}),
        ...(profile.exists && profile.valid === false && profile.errors ? { errors: profile.errors } : {}),
        ...(profile.exists && profile.valid && profile.missing ? { missing: profile.missing } : {}),
      },
      answers: {
        total: answers.exists && answers.valid ? (answers.total ?? 0) : 0,
        answered: answers.exists && answers.valid ? (answers.answered ?? 0) : 0,
        unanswered: answers.exists && answers.valid ? (answers.unanswered ?? []) : [],
        fromProfile: answers.exists && answers.valid ? (answers.fromProfile ?? []) : [],
      },
      preferences: {
        attachMode: await s.reviews.attachMode(),
        tone: prefs.tone,
        emphasis: prefs.emphasis,
        neverMention: prefs.neverMention,
        targets: prefs.targets,
        coverLetters: prefs.coverLetters,
      } satisfies OnboardPreferences,
      notifications: { turnEnd: (await s.workspace.readConfig()).notifications.turnEnd },
      library: await s.profile.libraryFiles(),
    };
  }

  // ---- internals ---------------------------------------------------------------------------------

  /** A template's PDF beside its main file, once built. */
  private async builtPdf(kind: "resume" | "cover", main?: string): Promise<{ pdf?: string }> {
    if (!main) return {};
    const abs = this.services().workspace.path("templates", kind, main.replace(/\.tex$/i, ".pdf"));
    return (await stat(abs).catch(() => null)) ? { pdf: this.rel(abs) } : {};
  }

  private async doneSummary(): Promise<OnboardingNext> {
    const check = await workspaceStatus(this.services());
    return {
      done: true,
      ready: check.ready,
      notDone: check.items.filter((i) => i.required && !i.done).map((i) => `${i.step}: ${i.detail}`),
    };
  }

  private rel(abs: string): string {
    return relative(this.services().workspace.root, abs).split(sep).join("/");
  }

  /** Tell the open page to read its state again. */
  private changed(): void {
    this.events.send("state");
  }

  /**
   * While a page listens, compare what it shows every couple of seconds and tell it when something changed
   * outside it: a login finished in another tab, the extension connected, the agent indexed a repo.
   */
  private startWatching(): void {
    if (this.watcher) return;
    this.watcher = setInterval(() => {
      if (this.events.count() === 0) {
        if (this.watcher) clearInterval(this.watcher);
        this.watcher = null;
        return;
      }
      void this.state()
        .then((st) => {
          const { tasks: _, agentListening: __, ...rest } = st;
          const print = JSON.stringify(rest);
          if (print !== this.fingerprint) {
            this.fingerprint = print;
            this.changed();
          }
        })
        .catch(() => {});
    }, WATCH_MS);
    this.watcher.unref();
  }
}

/** `owner/name` from a GitHub repository's address (or `owner/name` itself); null for anything else. */
export function repoFromUrl(input: string): string | null {
  const m =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(input.trim()) ??
    /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(input.trim());
  if (!m?.[1] || !m[2] || m[1].startsWith(".") || m[2].startsWith(".")) return null;
  return `${m[1]}/${m[2]}`;
}

/** Why a repo isn't suggested, by the rules that need no judgment; undefined to suggest it. */
export function skipReason(r: RepoInfo, login?: string): string | undefined {
  const [owner = "", name = ""] = r.fullName.split("/");
  if (r.archived) return "archived";
  if (r.fork) return "a fork";
  if (r.sizeKb < 10) return "nearly empty";
  if (name.toLowerCase() === owner.toLowerCase() || (login && name.toLowerCase() === login.toLowerCase())) {
    return "profile README";
  }
  if (/dotfiles|^\.github$|^\.?config(s)?$|^settings$/i.test(name)) return "dotfiles or config";
  return undefined;
}

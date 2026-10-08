import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EngineId } from "./documents/tex/engines.js";
import { resolveEngine } from "./documents/tex/engines.js";
import type { GitHubStatus } from "./github/service.js";
import type { Services } from "./services.js";
import { installCommand, installHint } from "./util/install-hints.js";
import { browserLabel } from "./util/open.js";
import { which } from "./util/proc.js";

export interface ChecklistItem {
  step: string;
  done: boolean;
  detail: string;
  /** Required for the core flow; optional items never block `ready`. */
  required: boolean;
}

/**
 * Whether Claude Code loads the workspace rules: EZAPPLY.md exists and the workspace CLAUDE.md imports it
 * (Claude Code expands `@EZAPPLY.md` at launch and again after compaction).
 */
export async function agentFileStatus(root: string): Promise<{ done: boolean; detail: string }> {
  const read = (f: string) => readFile(join(root, f), "utf8").catch(() => null);
  const [agent, claude] = await Promise.all([read("EZAPPLY.md"), read("CLAUDE.md")]);
  if (agent === null) return { done: false, detail: "EZAPPLY.md is missing: run `ezapply init`" };
  if (claude === null || !/^@EZAPPLY\.md[ \t]*$/m.test(claude)) {
    return {
      done: false,
      detail: "CLAUDE.md does not import EZAPPLY.md: add a line `@EZAPPLY.md` at its top (or run `ezapply init`)",
    };
  }
  return { done: true, detail: "EZAPPLY.md imported by CLAUDE.md" };
}

/**
 * Whether a TeX engine is usable for the configured `tex.engine`. `audience` picks the wording: the install
 * step as a hint for Claude (workspace_check), or as a command for a person (`ezapply doctor`).
 */
export async function texStatus(
  configured: EngineId | "auto",
  audience: "claude" | "user",
): Promise<{ done: boolean; detail: string }> {
  const engine = await resolveEngine(configured);
  if (engine) {
    const where = audience === "user" ? ` at ${which(engine.id) ?? "?"}` : "";
    return { done: true, detail: `engine: ${engine.id}${configured === "auto" ? " (auto)" : ""}${where}` };
  }
  return audience === "claude"
    ? { done: false, detail: `No TeX engine. ${installHint("tex")}` }
    : { done: false, detail: `none usable for "${configured}"; install: ${installCommand("tex")}` };
}

/** One line on the GitHub connection, shared by workspace_check and `ezapply doctor`. */
export function githubDetail(gh: GitHubStatus): string {
  const base = gh.loggedIn
    ? `logged in as ${gh.login}`
    : gh.appRegistered
      ? "app registered; not logged in"
      : "not set up: ask whether to create a new ezapply GitHub App or connect an existing one (github_login app)";
  return gh.portMismatch ? `${base}; ${gh.portMismatch.hint}` : base;
}

/**
 * Onboarding / readiness checklist, in the order the onboarding page shows its steps.
 * Each item is cheap to compute so Claude can call this freely.
 */
export async function workspaceStatus(
  s: Services,
): Promise<{ ready: boolean; nextStep?: string; items: ChecklistItem[] }> {
  const items: ChecklistItem[] = [];
  const add = (step: string, done: boolean, detail: string, required = true) =>
    items.push({ step, done, detail, required });

  const agent = await agentFileStatus(s.workspace.root);
  add("agent_file", agent.done, agent.detail);

  const config = await s.workspace.readConfig();
  const tex = await texStatus(config.tex.engine, "claude");
  add("tex", tex.done, tex.detail);

  const bridge = s.bridge.status();
  add(
    "extension",
    bridge.connected,
    bridge.connected
      ? `connected${bridge.browser ? ` in ${browserLabel(bridge.browser.name)}` : ""}`
      : bridge.paired
        ? "paired but not connected: ask the user to open the browser (reload the extension if the badge stays grey)"
        : "not paired: call extension_pair",
  );

  const gh = await s.github.status();
  add("github_login", gh.loggedIn && !gh.portMismatch, githubDetail(gh));

  const repos = await s.profile.repos();
  const selected = repos.exists && repos.valid ? repos.value.repos.length : 0;
  add(
    "repos_selected",
    selected > 0,
    repos.exists && !repos.valid ? "profile/repos.yaml is invalid" : `${selected} selected`,
  );

  const knowledge = await readdir(s.workspace.path("knowledge")).catch(() => [] as string[]);
  const indexed = knowledge.filter((k) => !k.startsWith(".")).length;
  add("knowledge_indexed", selected > 0 && indexed >= selected, `${indexed} indexed of ${selected} selected`);

  const resume = await s.templates.templateMain("resume");
  add("resume_template", resume !== null, resume ?? "not imported (template_import kind=resume)");

  const profile = await s.profile.checkProfile();
  add(
    "profile",
    profile.exists === true && profile.valid === true,
    !profile.exists
      ? "profile/profile.yaml missing"
      : profile.valid
        ? profile.missing?.length
          ? `valid; missing: ${profile.missing.join(", ")}`
          : "complete"
        : `invalid: ${profile.errors?.length} issue(s); run profile_check`,
  );

  const cover = await s.templates.templateMain("cover");
  const coverMeta = await s.templates.templateMeta("cover");
  add(
    "cover_template",
    cover !== null,
    !cover
      ? "missing; run `ezapply init` to install the default"
      : [
          cover,
          coverMeta?.origin === "default" ? "ezapply default" : undefined,
          coverMeta?.example ? `layout from ${coverMeta.example}` : undefined,
        ]
          .filter(Boolean)
          .join("; "),
  );

  const answers = await s.profile.checkAnswers();
  add(
    "answer_bank",
    answers.exists === true &&
      answers.valid === true &&
      (answers.unanswered?.length ?? 1) <= (answers.sensitive?.length ?? 0),
    !answers.exists
      ? "profile/answers.yaml missing"
      : answers.valid
        ? `${answers.answered}/${answers.total} answered`
        : "invalid; run answers_check",
  );

  const prefs = await s.profile.preferencesStatus();
  add(
    "preferences",
    prefs.words >= 10,
    prefs.exists ? `${prefs.words} words` : "profile/preferences.md missing",
    false,
  );

  const attach = await s.reviews.attachMode();
  add(
    "attach_mode",
    true,
    attach === "after-approval"
      ? "after-approval: documents are shown in the browser and attached once the user approves them"
      : "immediately: documents are attached as soon as they're built",
    false,
  );

  const library = await s.profile.libraryFiles();
  add("library", true, `${library.length} file(s)`, false);

  const next = items.find((i) => i.required && !i.done);
  return { ready: !next, ...(next ? { nextStep: next.step } : {}), items };
}

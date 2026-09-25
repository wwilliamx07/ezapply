import { readdir } from "node:fs/promises";
import { resolveEngine } from "./documents/tex/engines.js";
import type { Services } from "./services.js";

export interface ChecklistItem {
  step: string;
  done: boolean;
  detail: string;
  /** Required for the core flow; optional items never block `ready`. */
  required: boolean;
}

/**
 * Onboarding / readiness checklist, in the order the onboard skill walks through it.
 * Each item is cheap to compute so Claude can call this freely.
 */
export async function workspaceStatus(
  s: Services,
): Promise<{ ready: boolean; nextStep?: string; items: ChecklistItem[] }> {
  const items: ChecklistItem[] = [];
  const add = (step: string, done: boolean, detail: string, required = true) =>
    items.push({ step, done, detail, required });

  const config = await s.workspace.readConfig();
  const engine = await resolveEngine(config.tex.engine);
  add("tex", Boolean(engine), engine ? `engine: ${engine.id}` : "No TeX engine; run `ezapply doctor`.");

  const bridge = s.bridge.status();
  add(
    "extension",
    bridge.connected,
    bridge.connected
      ? "connected"
      : bridge.paired
        ? "paired but not connected (open the browser)"
        : "not paired (ezapply pair)",
  );

  const gh = await s.github.status();
  add(
    "github_login",
    gh.loggedIn,
    gh.loggedIn ? `logged in as ${gh.login}` : gh.appRegistered ? "app registered; not logged in" : "not set up",
  );

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

  const resume = await s.profile.templateMain("resume");
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

  const cover = await s.profile.templateMain("cover");
  add("cover_template", cover !== null, cover ?? "not created");

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

  const library = await s.profile.libraryFiles();
  add("library", true, `${library.length} file(s)`, false);

  const next = items.find((i) => i.required && !i.done);
  return { ready: !next, ...(next ? { nextStep: next.step } : {}), items };
}

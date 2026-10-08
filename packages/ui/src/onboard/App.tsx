import type { OnboardStepId } from "@ezapply/protocol";
import { type ReactNode, useState } from "react";
import { Banner, Brand, Button, Icon, MessagePage, Spinner } from "../components/ui.js";
import { ProfileStep } from "./ProfileStep.js";
import { TaskLine } from "./parts.js";
import { messageOf, OnboardContext, useOnboard, useOnboardState } from "./state.js";
import { AnswersStep, CoverStep, LibraryStep, PreferencesStep, ResumeStep } from "./steps-documents.js";
import { ExtensionStep, GitHubStep, KnowledgeStep, ReposStep, TexStep } from "./steps-setup.js";

const STEPS: { id: OnboardStepId; label: string; render(): ReactNode }[] = [
  { id: "tex", label: "LaTeX", render: () => <TexStep /> },
  { id: "extension", label: "Browser extension", render: () => <ExtensionStep /> },
  { id: "github", label: "GitHub", render: () => <GitHubStep /> },
  { id: "repos", label: "Repositories", render: () => <ReposStep /> },
  { id: "knowledge", label: "Your projects, read", render: () => <KnowledgeStep /> },
  { id: "resume", label: "Your resume", render: () => <ResumeStep /> },
  { id: "profile", label: "Your profile", render: () => <ProfileStep /> },
  { id: "cover", label: "Cover letter", render: () => <CoverStep /> },
  { id: "answers", label: "Screening questions", render: () => <AnswersStep /> },
  { id: "preferences", label: "Preferences", render: () => <PreferencesStep /> },
  { id: "library", label: "Library", render: () => <LibraryStep /> },
];

/**
 * Setting ezapply up, on a page: each workspace_check item a step, done ones ticked, in any order. What needs
 * Claude (installing, reading repositories, drafting the profile) goes to it as a task, and its progress shows
 * here.
 */
export function OnboardApp() {
  const onboard = useOnboardState();
  if (!onboard.state) {
    return onboard.error ? (
      <MessagePage title="The setup page isn't available">
        <p>{onboard.error}</p>
      </MessagePage>
    ) : (
      <div className="ez-loading">
        <Spinner label="Loading" />
      </div>
    );
  }
  return (
    <OnboardContext.Provider value={onboard}>
      <Onboarding />
    </OnboardContext.Provider>
  );
}

function Onboarding() {
  const { state, act, ask } = useOnboard();
  const firstOpen = state.steps.find((s) => s.required && !s.done)?.id ?? "tex";
  const [current, setCurrent] = useState<OnboardStepId>(firstOpen);
  const [finishing, setFinishing] = useState(false);
  const [question, setQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  // A new step starts at its top.
  const showStep = (id: OnboardStepId) => {
    setCurrent(id);
    document.getElementById("ob-main")?.scrollTo({ top: 0 });
  };

  if (state.status === "finished") {
    return (
      <MessagePage title={state.ready ? "You're set up" : "Setup paused"}>
        <p>
          {state.ready
            ? "Next: open a job posting in your browser and press the ezapply button (or Alt+Shift+P) to capture it. Then ask Claude for a resume, a cover letter, or to fill in the application."
            : "Some steps aren't done yet. Ask Claude to set you up again whenever you want to finish them."}
        </p>
        <p className="ez-muted">You can close this tab.</p>
      </MessagePage>
    );
  }

  const required = state.steps.filter((s) => s.required);
  const doneCount = required.filter((s) => s.done).length;
  const index = STEPS.findIndex((s) => s.id === current);
  const step = STEPS[index] ?? STEPS[0];
  const next = STEPS[index + 1];
  const tasks = [...state.tasks].reverse();

  return (
    <div className="ob">
      <header className="ez-topbar">
        <Brand />
        <div className="ez-topbar-title">
          <h1>Set up ezapply</h1>
          <span className="ez-muted">
            {doneCount} of {required.length} required steps done
          </span>
        </div>
        <div
          className="ob-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={required.length}
          aria-valuenow={doneCount}
        >
          <span style={{ width: `${(doneCount / Math.max(1, required.length)) * 100}%` }} />
        </div>
        <Button
          variant={state.ready ? "primary" : "default"}
          disabled={finishing}
          onClick={async () => {
            setFinishing(true);
            setError(null);
            try {
              await act("finish");
            } catch (e) {
              setError(messageOf(e));
              setFinishing(false);
            }
          }}
        >
          {state.ready ? "Finish setup" : "Finish later"}
        </Button>
      </header>

      <nav className="ob-nav" aria-label="Setup steps">
        <ol>
          {STEPS.map((s, i) => {
            const st = state.steps.find((x) => x.id === s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  className={`ob-nav-item${s.id === current ? " ob-nav-current" : ""}`}
                  aria-current={s.id === current ? "step" : undefined}
                  onClick={() => showStep(s.id)}
                >
                  <span className={`ob-nav-mark${st?.done ? " ob-nav-done" : ""}`} aria-hidden="true">
                    {st?.done ? <Icon name="check" size={14} /> : i + 1}
                  </span>
                  <span className="ob-nav-text">
                    {s.label}
                    {st && !st.required ? <span className="ob-nav-optional">optional</span> : null}
                  </span>
                  <span className="ez-sr-only">{st?.done ? "done" : "not done"}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <main className="ob-main" id="ob-main">
        {!state.agentFile.done ? (
          <Banner tone="warn" icon={<Icon name="alert" />}>
            {state.agentFile.detail}
          </Banner>
        ) : null}
        <article className="ob-step ez-card">{step?.render()}</article>
        <div className="ob-pager">
          {index > 0 ? (
            <Button variant="ghost" onClick={() => showStep(STEPS[index - 1]?.id ?? "tex")}>
              <Icon name="chevronLeft" size={16} /> Back
            </Button>
          ) : (
            <span />
          )}
          {next ? (
            <Button onClick={() => showStep(next.id)}>
              Next: {next.label} <Icon name="chevronRight" size={16} />
            </Button>
          ) : null}
        </div>
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </main>

      <aside className="ob-claude" aria-label="Claude">
        <h2>
          Claude{" "}
          <span className={`ob-live${state.agentListening ? " ob-live-on" : ""}`}>
            {state.agentListening ? "listening" : "busy or away"}
          </span>
        </h2>
        <p className="ez-help">
          Claude does the steps that need judgment. It works in your terminal, where you approve what it runs.
        </p>
        {tasks.length === 0 ? (
          <p className="ez-help">Nothing asked of Claude yet.</p>
        ) : (
          <ol className="ob-tasks">
            {tasks.map((t) => (
              <li key={t.id}>
                <span className="ob-task-kind">{TASK_LABELS[t.kind]}</span>
                <TaskLine task={t} listening={state.agentListening} />
              </li>
            ))}
          </ol>
        )}
        <form
          className="ob-ask"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!question.trim()) return;
            await ask("question", { text: question.trim() });
            setQuestion("");
          }}
        >
          <label className="ez-label" htmlFor="ob-question">
            Ask Claude
          </label>
          <textarea
            id="ob-question"
            className="ez-textarea"
            rows={2}
            value={question}
            placeholder="What does ezapply read in my repositories?"
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={!question.trim()}>
            Ask
          </Button>
        </form>
      </aside>
    </div>
  );
}

const TASK_LABELS: Record<string, string> = {
  "install-tex": "Install LaTeX",
  "index-repos": "Read repositories",
  "fix-template-build": "Fix the template's build",
  "draft-profile": "Draft your profile",
  "fill-cover-identity": "Name and contact in the letter",
  "restyle-cover": "Match the resume's look",
  "cover-from-example": "Letter from your example",
  "revise-cover": "Change the letter",
  question: "Your question",
};

import type { OnboardPreferences } from "@ezapply/protocol";
import { type DragEvent, useRef, useState } from "react";
import { Banner, Button, Icon, Spinner } from "../components/ui.js";
import { ErrorNote, PathPicker, PdfPreview, StepHead, TaskStatus, useBusy } from "./parts.js";
import { messageOf, useOnboard } from "./state.js";

interface CompileOutcome {
  ok: boolean;
  pdf?: string;
  pages?: number;
  pageLimit?: number;
  errors?: string[];
  hint?: string;
  main?: string;
}

/** Import a template from the user's own folder or file, build it, and say how that went. */
function ImportTemplate({
  kind,
  replace,
  onDone,
}: {
  kind: "resume" | "cover";
  replace: boolean;
  onDone(c: CompileOutcome): void;
}) {
  const { act } = useOnboard();
  const [mode, setMode] = useState<"folder" | "tex">("folder");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="ob-box">
      <fieldset className="ob-choice ob-choice-row">
        <legend className="ez-label">Your LaTeX {kind === "resume" ? "resume" : "cover letter"} is</legend>
        <label>
          <input type="radio" checked={mode === "folder"} onChange={() => setMode("folder")} /> a folder
        </label>
        <label>
          <input type="radio" checked={mode === "tex"} onChange={() => setMode("tex")} /> one .tex file
        </label>
      </fieldset>
      <PathPicker
        kind={mode}
        value={source}
        onChange={setSource}
        label={mode === "folder" ? "Its folder" : "Its .tex file"}
        placeholder={mode === "folder" ? "C:\\Users\\you\\Documents\\resume" : "C:\\Users\\you\\Documents\\resume.tex"}
      />
      <p className="ez-help">
        ezapply copies it into the workspace and watches the original, so later edits you make there are noticed.
      </p>
      <div className="ob-actions">
        <Button
          variant="primary"
          disabled={busy || !source.trim()}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const r = await act<{ compile: CompileOutcome }>("import", { kind, source: source.trim(), replace });
              onDone(r.compile);
            } catch (e) {
              setError(messageOf(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : null} Import and build
        </Button>
      </div>
      <ErrorNote error={error} />
    </div>
  );
}

function CompileResult({ result, kind }: { result: CompileOutcome; kind: "resume" | "cover" }) {
  const { ask } = useOnboard();
  const busy = useBusy(["fix-template-build"]);
  if (result.ok) {
    const over = result.pageLimit !== undefined && (result.pages ?? 0) > result.pageLimit;
    return (
      <Banner tone={over ? "warn" : "ok"} icon={<Icon name={over ? "alert" : "check"} />}>
        Built: {result.pages} {result.pages === 1 ? "page" : "pages"}
        {over ? `, over the ${result.pageLimit}-page limit. Tailored versions will be held to it.` : "."}
      </Banner>
    );
  }
  return (
    <>
      <Banner tone="danger" icon={<Icon name="alert" />}>
        It didn't build{result.errors?.length ? `: ${result.errors[0]}` : "."} {result.hint ?? ""}
      </Banner>
      <div className="ob-actions">
        <Button
          disabled={busy}
          onClick={() => ask("fix-template-build", { kind, main: result.main, errors: result.errors ?? [] })}
        >
          Ask Claude to fix the build
        </Button>
        <span className="ez-help">
          Claude fixes only what this computer needs (a font, an engine), never your text.
        </span>
      </div>
    </>
  );
}

export function ResumeStep() {
  const { state } = useOnboard();
  const [compiled, setCompiled] = useState<CompileOutcome | null>(null);
  const [changing, setChanging] = useState(false);
  const done = state.steps.find((s) => s.id === "resume")?.done ?? false;
  const doneTasks = state.tasks.filter((t) => t.status === "done").length;
  const pdf = compiled?.pdf ?? state.resume.pdf;
  return (
    <>
      <StepHead title="Your resume" done={done}>
        Your own LaTeX resume is the template every tailored resume starts from. Its look stays yours.
      </StepHead>
      {done && !changing ? (
        <div className="ob-row">
          <p>
            From <code>{state.resume.source ?? state.resume.main}</code>
          </p>
          <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>
            Import another
          </Button>
        </div>
      ) : (
        <ImportTemplate
          kind="resume"
          replace={done}
          onDone={(c) => {
            setCompiled(c);
            setChanging(false);
          }}
        />
      )}
      {compiled ? <CompileResult result={compiled} kind="resume" /> : null}
      <TaskStatus kinds={["fix-template-build"]} />
      {pdf ? <PdfPreview path={pdf} version={`${compiled?.pdf ?? ""}${doneTasks}`} /> : null}
    </>
  );
}

export function CoverStep() {
  const { state, ask, act } = useOnboard();
  const busy = useBusy(["fill-cover-identity", "restyle-cover", "cover-from-example", "revise-cover"]);
  const [choice, setChoice] = useState<"default" | "own" | "example">("default");
  const [compiled, setCompiled] = useState<CompileOutcome | null>(null);
  const [request, setRequest] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const doneTasks = state.tasks.filter((t) => t.status === "done").length;
  const pdf = compiled?.pdf ?? state.cover.pdf;
  const done = state.steps.find((s) => s.id === "cover")?.done ?? false;
  return (
    <>
      <StepHead title="Cover letter template" done={done}>
        {state.cover.isDefault
          ? "ezapply starts you with a plain one-page letter. Keep it, use your own LaTeX letter, or have Claude copy the layout of one you like."
          : "Your cover letters are built from this template."}
      </StepHead>
      <fieldset className="ob-choice">
        <legend className="ez-label">Template</legend>
        <label>
          <input type="radio" checked={choice === "default"} onChange={() => setChoice("default")} />{" "}
          {state.cover.isDefault ? "Keep ezapply's letter" : "Keep this one"}
        </label>
        <label>
          <input type="radio" checked={choice === "own"} onChange={() => setChoice("own")} /> Use my own LaTeX cover
          letter
        </label>
        <label>
          <input type="radio" checked={choice === "example"} onChange={() => setChoice("example")} /> Copy the layout of
          a letter I like (a PDF or a picture)
        </label>
      </fieldset>
      {choice === "default" ? (
        <div className="ob-actions">
          {state.cover.isDefault ? (
            <Button
              variant="primary"
              disabled={busy || !state.profile.valid}
              onClick={() => ask("fill-cover-identity")}
            >
              Put my name and contact in it
            </Button>
          ) : null}
          <Button disabled={busy || !state.resume.main} onClick={() => ask("restyle-cover")}>
            Match my resume's look
          </Button>
          <Button
            variant="ghost"
            disabled={building}
            onClick={async () => {
              setBuilding(true);
              setError(null);
              try {
                setCompiled((await act<{ compile: CompileOutcome }>("compile", { kind: "cover" })).compile);
              } catch (e) {
                setError(messageOf(e));
              } finally {
                setBuilding(false);
              }
            }}
          >
            {building ? <Spinner /> : null} Show a preview
          </Button>
        </div>
      ) : null}
      {choice === "default" && state.cover.isDefault && !state.profile.valid ? (
        <p className="ez-help">Your profile comes first: the letter takes your name and contact from it.</p>
      ) : null}
      {choice === "own" ? <ImportTemplate kind="cover" replace onDone={setCompiled} /> : null}
      {choice === "example" ? <ExampleLetter /> : null}
      <ErrorNote error={error} />
      {compiled ? <CompileResult result={compiled} kind="cover" /> : null}
      <TaskStatus kinds={["fill-cover-identity", "restyle-cover", "cover-from-example", "revise-cover"]} />
      {pdf ? (
        <>
          <PdfPreview path={pdf} version={`${compiled?.pdf ?? ""}${doneTasks}`} />
          <div className="ez-field">
            <label className="ez-label" htmlFor="ob-cover-change">
              Anything to change in how it looks?
            </label>
            <textarea
              id="ob-cover-change"
              className="ez-textarea"
              rows={2}
              value={request}
              placeholder="Smaller margins, the date on the right, my name in bold…"
              onChange={(e) => setRequest(e.target.value)}
            />
          </div>
          <div className="ob-actions">
            <Button
              disabled={busy || !request.trim()}
              onClick={async () => {
                await ask("revise-cover", { request: request.trim() });
                setRequest("");
              }}
            >
              Ask Claude to change it
            </Button>
          </div>
        </>
      ) : null}
    </>
  );
}

function ExampleLetter() {
  const { ask } = useOnboard();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <FileDrop
        accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md"
        label="Drop the example letter here, or choose it"
        onSaved={async (saved) => {
          setBusy(true);
          setError(null);
          try {
            await ask("cover-from-example", { file: saved });
          } catch (e) {
            setError(messageOf(e));
          } finally {
            setBusy(false);
          }
        }}
      />
      <p className="ez-help">
        Only its layout is used, never its words. A Word file: save it as PDF first. It's kept in your library.
      </p>
      {busy ? <Spinner /> : null}
      <ErrorNote error={error} />
    </>
  );
}

export function AnswersStep() {
  const { state, act } = useOnboard();
  const { unanswered, total, answered } = state.answers;
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const group = unanswered.slice(0, 8);
  const done = state.steps.find((s) => s.id === "answers")?.done ?? false;
  // Sensitive questions get their suggestion too: Claude still asks about them every time, offering what's saved.
  const answerOf = (id: string, suggested?: string) => values[id] ?? suggested ?? "";
  return (
    <>
      <StepHead title="Screening questions" done={done}>
        Applications ask the same questions again and again. Answer them once here; Claude uses your answers and asks
        you about anything new.
      </StepHead>
      <p className="ez-muted">
        {answered} of {total} answered.
      </p>
      {group.length === 0 ? (
        <p>Every question has an answer. You can change them any time in profile/answers.yaml, or ask Claude.</p>
      ) : (
        <>
          <ol className="ob-questions">
            {group.map((q) => (
              <li key={q.id} className="ez-field">
                <label className="ez-label" htmlFor={`ob-q-${q.id}`}>
                  {q.canonical}
                </label>
                <input
                  id={`ob-q-${q.id}`}
                  className="ez-input"
                  value={answerOf(q.id, q.suggested)}
                  placeholder={q.sensitive ? "Leave empty to be asked every time" : ""}
                  onChange={(e) => setValues((v) => ({ ...v, [q.id]: e.target.value }))}
                />
                {q.sensitive ? (
                  <span className="ez-help">
                    Sensitive: Claude asks you each time, suggesting what you save here (leave it empty for no
                    suggestion).
                  </span>
                ) : q.suggested ? (
                  <span className="ez-help">Suggested; change it if it isn't right for you.</span>
                ) : q.source ? (
                  <span className="ez-help">
                    Usually taken from your profile ({q.source.replace(/^profile\./, "")}).
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="ob-actions">
            <Button
              variant="primary"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setError(null);
                try {
                  const answers: Record<string, string | null> = {};
                  for (const q of group) {
                    const v = answerOf(q.id, q.suggested).trim();
                    answers[q.id] = v || null;
                  }
                  await act("answers", { answers });
                  setValues({});
                } catch (e) {
                  setError(messageOf(e));
                } finally {
                  setSaving(false);
                }
              }}
            >
              Save {group.length === 1 ? "this answer" : `these ${group.length}`}
            </Button>
            <span className="ez-help">
              {unanswered.length > group.length ? `${unanswered.length - group.length} more after these.` : ""}
            </span>
          </div>
          <ErrorNote error={error} />
        </>
      )}
    </>
  );
}

export function PreferencesStep() {
  const { state, act } = useOnboard();
  const [prefs, setPrefs] = useState<OnboardPreferences>(state.preferences);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof OnboardPreferences, v: string) => {
    setPrefs((p) => ({ ...p, [k]: v }));
    setSaved(false);
  };
  const area = (k: Exclude<keyof OnboardPreferences, "attachMode">, label: string, placeholder: string) => (
    <div className="ez-field">
      <label className="ez-label" htmlFor={`ob-pref-${k}`}>
        {label}
      </label>
      <textarea
        id={`ob-pref-${k}`}
        className="ez-textarea"
        rows={2}
        value={prefs[k]}
        placeholder={placeholder}
        onChange={(e) => set(k, e.target.value)}
      />
    </div>
  );
  return (
    <>
      <StepHead title="Preferences" done={state.steps.find((s) => s.id === "preferences")?.done ?? false}>
        How Claude writes for you, and how documents reach your applications.
      </StepHead>
      <fieldset className="ob-choice">
        <legend className="ez-label">Before a document is attached to an application</legend>
        <label>
          <input
            type="radio"
            checked={prefs.attachMode === "after-approval"}
            onChange={() => set("attachMode", "after-approval")}
          />{" "}
          Show it to me first, and attach it once I approve it <span className="ez-muted">(recommended)</span>
        </label>
        <label>
          <input
            type="radio"
            checked={prefs.attachMode === "immediately"}
            onChange={() => set("attachMode", "immediately")}
          />{" "}
          Attach it as soon as it's built
        </label>
      </fieldset>
      {area("tone", "Tone for cover letters", "Warm but direct; no clichés.")}
      {area("emphasis", "What to emphasize", "Backend and infrastructure work; leading small teams.")}
      {area("neverMention", "Never mention", "My first job; that I'm on a visa.")}
      {area("targets", "Roles and places you're aiming for", "Backend engineer, platform engineer; Toronto or remote.")}
      {area("coverLetters", "Cover letters", "Write one for every application, unless I say otherwise.")}
      <div className="ob-actions">
        <Button
          variant="primary"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setError(null);
            try {
              await act("preferences", { ...prefs });
              setSaved(true);
            } catch (e) {
              setError(messageOf(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          Save preferences
        </Button>
        {saved ? <span className="ob-saved">Saved</span> : null}
      </div>
      <ErrorNote error={error} />
    </>
  );
}

export function LibraryStep() {
  const { state } = useOnboard();
  return (
    <>
      <StepHead title="Library" done={state.library.length > 0}>
        Transcripts, certificates and writing samples you may be asked to attach. Optional: add them any time.
      </StepHead>
      <FileDrop
        accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.webp,.txt,.md,.tex"
        label="Drop files here, or choose them"
        multiple
      />
      {state.library.length ? (
        <ul className="ob-list">
          {state.library.map((f) => (
            <li key={f}>
              <Icon name="file" size={16} /> {f}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** Files into library/: dropped, or chosen with the browser's picker (their contents are all that's needed here). */
function FileDrop({
  accept,
  label,
  multiple = false,
  onSaved,
}: {
  accept: string;
  label: string;
  multiple?: boolean;
  onSaved?(path: string): void;
}) {
  const { base, refresh } = useOnboard();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (files: FileList | File[]) => {
    setBusy(true);
    setError(null);
    try {
      for (const f of [...files].slice(0, multiple ? 20 : 1)) {
        const res = await fetch(`${base}/library?name=${encodeURIComponent(f.name)}`, {
          method: "POST",
          credentials: "same-origin",
          body: f,
        });
        const out = (await res.json().catch(() => null)) as { saved?: string; error?: string } | null;
        if (!res.ok || !out?.saved) throw new Error(out?.error ?? `${f.name} wasn't saved.`);
        onSaved?.(out.saved);
      }
      void refresh();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
  };
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the button inside is the keyboard's way in */}
      <div
        className={`ob-drop${over ? " ob-drop-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <Icon name="file" size={22} />
        <span>{label}</span>
        <Button size="sm" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <Spinner /> : null} Choose…
        </Button>
        <input
          ref={input}
          type="file"
          accept={accept}
          multiple={multiple}
          hidden
          onChange={(e) => e.target.files && void upload(e.target.files)}
        />
      </div>
      <ErrorNote error={error} />
    </>
  );
}

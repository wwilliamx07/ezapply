import type { OnboardTask, OnboardTaskKind } from "@ezapply/protocol";
import { type ReactNode, useEffect, useState } from "react";
import { Banner, Button, Icon, Spinner } from "../components/ui.js";
import { type LoadedPdf, loadPdf } from "../lib/pdf.js";
import { Viewer } from "../review/Viewer.js";
import { messageOf, useOnboard } from "./state.js";

/** A value the user copies into another program: a path, a command, an address. */
export function Copyable({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ob-copy">
      <code title={label}>{value}</code>
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {}
        }}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** A path on this computer, typed or chosen in the system's own dialog. */
export function PathPicker({
  value,
  onChange,
  kind,
  label,
  placeholder,
}: {
  value: string;
  onChange(v: string): void;
  kind: "folder" | "tex";
  label: string;
  placeholder: string;
}) {
  const { act } = useOnboard();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const id = `ob-path-${kind}-${label.replace(/\W+/g, "-")}`;
  return (
    <div className="ez-field">
      <label className="ez-label" htmlFor={id}>
        {label}
      </label>
      <div className="ob-row">
        <input
          id={id}
          className="ez-input ob-mono"
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setNote(null);
            try {
              const r = await act<{ path?: string; cancelled?: true; unavailable?: true }>("browse", {
                kind,
                title: label,
              });
              if (r.path) onChange(r.path);
              else if (r.unavailable) setNote("No file dialog on this system: type the path instead.");
            } catch (e) {
              setNote(messageOf(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner /> : null} Browse…
        </Button>
      </div>
      {note ? <span className="ez-help">{note}</span> : null}
      {busy ? <span className="ez-help">A dialog opened on your desktop. It may be behind this window.</span> : null}
    </div>
  );
}

/** The latest task of these kinds, as the page shows it: queued, running, done with Claude's note, or failed. */
export function TaskStatus({ kinds }: { kinds: OnboardTaskKind[] }) {
  const { state } = useOnboard();
  const task = [...state.tasks].reverse().find((t) => kinds.includes(t.kind));
  if (!task) return null;
  return <TaskLine task={task} listening={state.agentListening} agentIn={state.agentIn} />;
}

/** Where the user sees Claude: the ezapply panel, or a terminal (no panel agent). */
export function TaskLine({
  task,
  listening,
  agentIn,
}: {
  task: OnboardTask;
  listening: boolean;
  agentIn: "panel" | "terminal";
}) {
  if (task.status === "queued") {
    return (
      <Banner icon={<Spinner />}>
        {listening
          ? "Claude is picking this up…"
          : agentIn === "panel"
            ? "Waiting for Claude. Open the ezapply panel from your browser's toolbar to see what it's doing."
            : "Waiting for Claude. If nothing happens, tell Claude in the terminal: “continue setting me up”."}
      </Banner>
    );
  }
  if (task.status === "running") {
    return (
      <Banner icon={<Spinner />}>
        {agentIn === "panel"
          ? "Claude is working on it. It may ask you to approve something in the ezapply panel."
          : "Claude is working on it. It may ask you to approve something in the terminal."}
      </Banner>
    );
  }
  return (
    <Banner
      tone={task.status === "done" ? "ok" : "danger"}
      icon={<Icon name={task.status === "done" ? "check" : "alert"} />}
    >
      {task.note ?? (task.status === "done" ? "Claude finished." : "Claude couldn't finish this.")}
    </Banner>
  );
}

/** Whether a task of these kinds is queued or running. */
export function useBusy(kinds: OnboardTaskKind[]): boolean {
  const { state } = useOnboard();
  return state.tasks.some((t) => kinds.includes(t.kind) && (t.status === "queued" || t.status === "running"));
}

/** A built template's PDF, in the review page's viewer (without comments). */
export function PdfPreview({ path, version }: { path: string; version: string }) {
  const { base } = useOnboard();
  const [pdf, setPdf] = useState<LoadedPdf | Error | null>(null);
  const url = `${base}/file?path=${encodeURIComponent(path)}&v=${encodeURIComponent(version)}`;
  useEffect(() => {
    let live = true;
    setPdf(null);
    loadPdf(url).then(
      (p) => live && setPdf(p),
      (e) => live && setPdf(e instanceof Error ? e : new Error(String(e))),
    );
    return () => {
      live = false;
    };
  }, [url]);
  return (
    <div className="ob-preview">
      {!pdf ? (
        <div className="ez-center">
          <Spinner label="Loading the preview" />
        </div>
      ) : pdf instanceof Error ? (
        <div className="ez-center">
          <Banner tone="danger">The preview couldn't be shown: {pdf.message}</Banner>
        </div>
      ) : (
        <Viewer
          pdf={pdf}
          name={path.split("/").pop() ?? path}
          downloadUrl={url}
          changes={[]}
          showChanges={false}
          onToggleChanges={null}
          comments={[]}
          active={null}
          jump={null}
          onActivate={() => {}}
        />
      )}
    </div>
  );
}

export function StepHead({ title, done, children }: { title: string; done: boolean; children?: ReactNode }) {
  return (
    <header className="ob-step-head">
      <div className="ob-row">
        <h2>{title}</h2>
        {done ? (
          <span className="ez-badge ez-badge-ok">
            <Icon name="check" size={14} /> Done
          </span>
        ) : null}
      </div>
      {children ? <p className="ob-lead">{children}</p> : null}
    </header>
  );
}

/** An error from an action, under the button that ran it. */
export function ErrorNote({ error }: { error: string | null }) {
  return error ? (
    <Banner tone="danger" icon={<Icon name="alert" />}>
      {error}
    </Banner>
  ) : null;
}

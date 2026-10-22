import type {
  WorkspaceChangeOutcome,
  WorkspaceChangeRequest,
  WorkspaceChanges,
  WorkspaceChangeView,
} from "@ezapply/protocol";
import { useState } from "react";
import { Badge, Button, Spinner } from "./ui.js";

type Act = (req: WorkspaceChangeRequest) => Promise<{ outcomes: WorkspaceChangeOutcome[] }>;

/** What a repo's new commits can be put off for. */
const PUT_OFF = [
  { hours: 24, label: "a day" },
  { hours: 24 * 7, label: "a week" },
  { hours: 24 * 30, label: "a month" },
];

/** Kinds Update brings current without asking anything more, so "Update all" covers them. */
const PLAIN_UPDATE = new Set(["template-source", "profile-identity", "resume-edited", "repo-pushed"]);

function outcomeText(o: WorkspaceChangeOutcome, agentName: string): string {
  const text = {
    updated: "Updated.",
    task: `Handed to ${agentName}: follow it in the General conversation.`,
    dialog: "Choose it in the window that opened on your computer.",
    later: "Put off.",
    done: "Kept as it is.",
    cancelled: "Nothing chosen.",
    failed: "That didn't work.",
  }[o.outcome];
  return o.note ? `${text} ${o.note}` : text;
}

/**
 * What's out of date in the workspace, each with what the user can do about it: the panel's Workspace changes card
 * and the setup page's Changes list. Nothing changes until a button is pressed: that press is the user's yes.
 */
export function WorkspaceChangesList({
  data,
  act,
  agentName,
}: {
  data: WorkspaceChanges;
  act: Act;
  agentName: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  // What each press did, kept after the change leaves the list so the user sees it went through.
  const [notes, setNotes] = useState<Record<string, { summary: string; text: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, req: WorkspaceChangeRequest) => {
    setBusy(key);
    setError(null);
    try {
      const { outcomes } = await act(req);
      setNotes((n) => {
        const next = { ...n };
        for (const o of outcomes) {
          const summary = data.changes.find((c) => c.id === o.id)?.summary ?? "";
          next[o.id] = { summary, text: outcomeText(o, agentName) };
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const plain = data.changes.filter((c) => PLAIN_UPDATE.has(c.kind) && !c.working);
  return (
    <div className="ez-changes">
      <ul>
        {data.changes.map((c) => (
          <li key={c.id}>
            <p className="ez-changes-summary">
              {c.summary} {c.needed ? <Badge tone="warn">this work uses it</Badge> : null}
            </p>
            {c.working ? (
              <p className="ez-help">
                <Spinner /> Being updated…
              </p>
            ) : (
              <ChangeButtons change={c} disabled={busy !== null} run={(req) => run(c.id, { ...req, ids: [c.id] })} />
            )}
            {c.note ? <p className="ez-changes-error">{c.note}</p> : null}
            {notes[c.id] ? <p className="ez-help">{notes[c.id]?.text}</p> : null}
          </li>
        ))}
      </ul>
      {Object.entries(notes)
        .filter(([id]) => !data.changes.some((c) => c.id === id))
        .map(([id, n]) => (
          <p key={id} className="ez-help">
            {n.summary} {n.text}
          </p>
        ))}
      {plain.length > 1 ? (
        <Button
          size="sm"
          variant="primary"
          disabled={busy !== null}
          onClick={() => run("all", { ids: plain.map((c) => c.id), action: "update" })}
        >
          Update all {plain.length}
        </Button>
      ) : null}
      {error ? <p className="ez-changes-error">{error}</p> : null}
      {data.deferred?.length ? (
        <p className="ez-help">
          Put off: {data.deferred.map((d) => `${d.repo} until ${new Date(d.until).toLocaleDateString()}`).join(", ")}.
        </p>
      ) : null}
      {data.notChecked?.map((n) => (
        <p key={n.what} className="ez-help">
          Couldn't check {n.what}: {n.reason}
          {n.hint ? ` ${n.hint}` : ""}
        </p>
      ))}
    </div>
  );
}

type Req = Omit<WorkspaceChangeRequest, "ids">;

function ChangeButtons({
  change,
  disabled,
  run,
}: {
  change: WorkspaceChangeView;
  disabled: boolean;
  run: (req: Req) => void;
}) {
  const [putOff, setPutOff] = useState(PUT_OFF[0]?.hours ?? 24);
  const b = (label: string, req: Req, variant: "primary" | "default" | "ghost" = "default") => (
    <Button key={label} size="sm" variant={variant} disabled={disabled} onClick={() => run(req)}>
      {label}
    </Button>
  );
  const later = b("Later", { action: "later" }, "ghost");
  switch (change.kind) {
    case "template-source":
      return (
        <div className="ez-changes-actions">
          {b("Update now", { action: "update" }, "primary")}
          {b("Keep the current copy", { action: "done" })}
          {later}
        </div>
      );
    case "template-untracked":
      return (
        <div className="ez-changes-actions">
          {b("Choose the file I edit", { action: "update", pick: "tex" }, "primary")}
          {b("Choose the folder", { action: "update", pick: "folder" })}
          {b("I keep none", { action: "done" })}
          {later}
        </div>
      );
    case "library-template":
      return (
        <div className="ez-changes-actions">
          {b("It's my resume", { action: "update", kind: "resume" }, "primary")}
          {b("It's my cover letter", { action: "update", kind: "cover" })}
          {b("Neither", { action: "done" })}
          {later}
        </div>
      );
    case "resume-edited":
      return (
        <div className="ez-changes-actions">
          {b("Update my profile", { action: "update" }, "primary")}
          {b("Nothing to change", { action: "done" })}
          {later}
        </div>
      );
    case "profile-identity":
      return (
        <div className="ez-changes-actions">
          {b("Update now", { action: "update" }, "primary")}
          {later}
        </div>
      );
    case "repo-pushed":
      return (
        <div className="ez-changes-actions">
          {b("Read it again", { action: "update" }, "primary")}
          <select
            className="ez-input ez-changes-select"
            aria-label="Put off for"
            value={putOff}
            disabled={disabled}
            onChange={(e) => setPutOff(Number(e.target.value))}
          >
            {PUT_OFF.map((p) => (
              <option key={p.hours} value={p.hours}>
                for {p.label}
              </option>
            ))}
          </select>
          {b("Put off", { action: "later", hours: putOff }, "ghost")}
        </div>
      );
    case "repo-deselected":
      return (
        <div className="ez-changes-actions">
          {b("Select it again", { action: "update" })}
          <Button
            size="sm"
            variant="danger"
            disabled={disabled}
            onClick={() => {
              if (window.confirm("Delete what ezapply wrote down about this repository, and its copy, for good?")) {
                run({ action: "done", confirm: true });
              }
            }}
          >
            Delete its knowledge
          </Button>
          {later}
        </div>
      );
  }
}

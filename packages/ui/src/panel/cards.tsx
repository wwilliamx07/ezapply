import {
  type AgentEvent,
  type AskAnswer,
  type AskAnswers,
  type AskCard,
  type AskQuestion,
  askAnswerProblems,
  type PermissionCard,
} from "@ezapply/protocol";
import { useId, useState } from "react";
import { Badge, Button } from "../components/ui.js";

interface Draft {
  /** single: the chosen value; multi: the chosen values; text: the text. */
  value: string | string[];
  /** The "Other" text (single and multi), used when `useOther`. */
  other: string;
  useOther: boolean;
  remember: boolean;
}

/** A question's starting state: the agent's suggestion filled in, as options where it names them, else as Other. */
export function initialDraft(q: AskQuestion): Draft {
  const proposed = q.proposed === undefined ? [] : Array.isArray(q.proposed) ? q.proposed : [q.proposed];
  const values = new Set((q.options ?? []).map((o) => o.value));
  if (q.type === "text")
    return { value: typeof q.proposed === "string" ? q.proposed : "", other: "", useOther: false, remember: false };
  const known = proposed.filter((p) => values.has(p));
  const unknown = proposed.filter((p) => !values.has(p));
  const other = q.allowOther ? unknown.join(", ") : "";
  if (q.type === "single") {
    return { value: known[0] ?? "", other, useOther: !known[0] && Boolean(other), remember: false };
  }
  return { value: known, other, useOther: Boolean(other), remember: false };
}

/** The answer a draft gives, or a skip for an optional question left empty. */
export function answerOf(q: AskQuestion, d: Draft): AskAnswer {
  const remember = d.remember && q.remember ? { remember: true as const } : {};
  if (q.type === "text") {
    const text = typeof d.value === "string" ? d.value : "";
    return !text.trim() && q.required === false ? { skipped: true } : { value: text, ...remember };
  }
  if (q.type === "single") {
    if (d.useOther && d.other.trim()) return { value: d.other.trim(), other: true, ...remember };
    const v = typeof d.value === "string" ? d.value : "";
    return !v && q.required === false ? { skipped: true } : { value: v, ...remember };
  }
  const chosen = Array.isArray(d.value) ? d.value : [];
  const all = d.useOther && d.other.trim() ? [...chosen, d.other.trim()] : chosen;
  if (all.length === 0 && q.required === false) return { skipped: true };
  return { value: all, ...(d.useOther && d.other.trim() ? { other: true as const } : {}), ...remember };
}

export function AskCardView({
  card,
  label,
  onAnswer,
  onReply,
}: {
  card: AskCard;
  /** The conversation it belongs to, when it isn't the one shown. */
  label?: string;
  onAnswer: (answers: AskAnswers) => Promise<void>;
  onReply: (message: string) => Promise<void>;
}) {
  const { spec } = card;
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(spec.questions.map((q) => [q.id, initialDraft(q)])),
  );
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (id: string, change: Partial<Draft>) => {
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] as Draft), ...change } }));
    setProblems((p) => {
      const { [id]: _, ...rest } = p;
      return rest;
    });
  };
  const anyRemember = spec.questions.some((q) => q.remember);

  const send = async () => {
    const answers: AskAnswers = Object.fromEntries(
      spec.questions.map((q) => [q.id, answerOf(q, drafts[q.id] as Draft)]),
    );
    const found = askAnswerProblems(spec, answers);
    if (found.length > 0) {
      setProblems(Object.fromEntries(found.map((p) => [p.split(":")[0] ?? "", p.slice(p.indexOf(":") + 1).trim()])));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAnswer(answers);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  const sendReply = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onReply(reply.trim());
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <section className="ez-pcard" aria-label={spec.title}>
      <header className="ez-pcard-head">
        <strong>{spec.title}</strong>
        {label ? <span className="ez-muted">{label}</span> : null}
      </header>
      {spec.intro ? <p className="ez-pcard-intro">{spec.intro}</p> : null}
      {spec.questions.map((q) => (
        <QuestionView
          key={q.id}
          q={q}
          draft={drafts[q.id] as Draft}
          problem={problems[q.id]}
          onChange={(c) => set(q.id, c)}
        />
      ))}
      {anyRemember ? <p className="ez-help">Answers you tick "Save for next time" go into your answer bank.</p> : null}
      {error ? <p className="ez-pcard-error">{error}</p> : null}
      {replying ? (
        <div className="ez-pcard-reply">
          <textarea
            className="ez-textarea"
            rows={3}
            value={reply}
            placeholder="Your answer, in your own words"
            onChange={(e) => setReply(e.target.value)}
            aria-label="Reply in the chat"
          />
          <div className="ez-pcard-actions">
            <Button variant="primary" size="sm" disabled={busy || !reply.trim()} onClick={sendReply}>
              Send reply
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setReplying(false)}>
              Back to the questions
            </Button>
          </div>
        </div>
      ) : (
        <div className="ez-pcard-actions">
          <Button variant="primary" size="sm" disabled={busy} onClick={send}>
            Send answers
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setReplying(true)}>
            Reply in chat instead
          </Button>
        </div>
      )}
    </section>
  );
}

function QuestionView({
  q,
  draft,
  problem,
  onChange,
}: {
  q: AskQuestion;
  draft: Draft;
  problem: string | undefined;
  onChange: (c: Partial<Draft>) => void;
}) {
  const id = useId();
  const suggested = q.proposed !== undefined;
  const isSuggested = (v: string) =>
    q.proposed !== undefined && (Array.isArray(q.proposed) ? q.proposed.includes(v) : q.proposed === v);
  return (
    <fieldset className="ez-q" aria-describedby={problem ? `${id}-err` : undefined}>
      <legend className="ez-q-prompt">
        {q.prompt}
        {q.required === false ? <span className="ez-muted"> (optional)</span> : null}
        {q.sensitive ? (
          <>
            {" "}
            <Badge tone="warn">sensitive</Badge>
          </>
        ) : null}
      </legend>
      {q.type === "text" ? (
        q.multiline ? (
          <textarea
            className="ez-textarea"
            rows={3}
            value={typeof draft.value === "string" ? draft.value : ""}
            placeholder={q.placeholder}
            maxLength={q.maxLength}
            aria-label={q.prompt}
            onChange={(e) => onChange({ value: e.target.value })}
          />
        ) : (
          <input
            className="ez-input"
            value={typeof draft.value === "string" ? draft.value : ""}
            placeholder={q.placeholder}
            maxLength={q.maxLength}
            aria-label={q.prompt}
            onChange={(e) => onChange({ value: e.target.value })}
          />
        )
      ) : (
        <div className="ez-q-options">
          {(q.options ?? []).map((o) => {
            const checked =
              q.type === "single"
                ? draft.value === o.value && !draft.useOther
                : (draft.value as string[]).includes(o.value);
            return (
              <label key={o.value} className="ez-q-option">
                <input
                  type={q.type === "single" ? "radio" : "checkbox"}
                  name={id}
                  checked={checked}
                  onChange={(e) => {
                    if (q.type === "single") onChange({ value: o.value, useOther: false });
                    else {
                      const cur = draft.value as string[];
                      onChange({ value: e.target.checked ? [...cur, o.value] : cur.filter((v) => v !== o.value) });
                    }
                  }}
                />
                <span>
                  {o.label ?? o.value}
                  {isSuggested(o.value) ? <span className="ez-q-suggested"> suggested</span> : null}
                  {o.description ? <span className="ez-q-desc">{o.description}</span> : null}
                </span>
              </label>
            );
          })}
          {q.allowOther ? (
            <label className="ez-q-option">
              <input
                type={q.type === "single" ? "radio" : "checkbox"}
                name={id}
                checked={draft.useOther}
                onChange={(e) => onChange({ useOther: q.type === "single" ? true : e.target.checked })}
              />
              <span>Other</span>
              <input
                className="ez-input ez-q-other"
                value={draft.other}
                aria-label={`${q.prompt}: other`}
                onChange={(e) => onChange({ other: e.target.value, useOther: true })}
              />
            </label>
          ) : null}
        </div>
      )}
      {suggested && q.type === "text" ? <p className="ez-q-suggested">Filled in with a suggestion.</p> : null}
      {q.why ? <p className="ez-q-why">{q.why}</p> : null}
      {q.remember ? (
        <label className="ez-q-remember">
          <input type="checkbox" checked={draft.remember} onChange={(e) => onChange({ remember: e.target.checked })} />{" "}
          Save for next time
        </label>
      ) : null}
      {problem ? (
        <p className="ez-pcard-error" id={`${id}-err`}>
          {problem}
        </p>
      ) : null}
    </fieldset>
  );
}

/** What an approval would run, for the user to read whole: the command, or the file and the change. */
export function permissionBody(card: PermissionCard): { title: string; lines: { label?: string; text: string }[] } {
  const i = (card.input ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : undefined);
  switch (card.toolName) {
    case "Bash":
    case "PowerShell":
      return { title: "Run a command", lines: [{ text: s("command") ?? "" }] };
    case "Write":
      return {
        title: "Write a file",
        lines: [
          { label: "File", text: s("file_path") ?? "" },
          { label: "Content", text: s("content") ?? "" },
        ],
      };
    case "Edit":
      return {
        title: "Edit a file",
        lines: [
          { label: "File", text: s("file_path") ?? "" },
          { label: "Replace", text: s("old_string") ?? "" },
          { label: "With", text: s("new_string") ?? "" },
        ],
      };
    case "WebFetch":
      return { title: "Fetch a web page", lines: [{ text: s("url") ?? "" }] };
    // Codex's approvals (`codex.ts`): a command, a patch to files, more access than its sandbox gives.
    case "Shell":
      return {
        title: "Run a command",
        lines: [{ text: s("command") ?? "" }, ...(s("cwd") ? [{ label: "In", text: s("cwd") ?? "" }] : [])],
      };
    case "Patch": {
      const files = Array.isArray(i.files) ? i.files.filter((f): f is string => typeof f === "string") : [];
      return {
        title: files.length > 1 ? "Edit files" : "Edit a file",
        lines: [
          { label: files.length > 1 ? "Files" : "File", text: files.join("\n") || (s("file_path") ?? "") },
          ...(s("diff") ? [{ label: "Changes", text: s("diff") ?? "" }] : []),
        ],
      };
    }
    case "Permissions":
      return { title: "Get more access", lines: [{ text: JSON.stringify(i.permissions ?? {}, null, 2) }] };
    default:
      return { title: `Use ${card.toolName}`, lines: [{ text: JSON.stringify(card.input, null, 2) }] };
  }
}

export function PermissionCardView({
  card,
  label,
  agent = "Claude",
  onDecide,
}: {
  card: PermissionCard;
  label?: string;
  /** Who asks ("Claude Code", "Codex"). */
  agent?: string;
  onDecide: (allow: boolean, reason?: string) => Promise<void>;
}) {
  const body = permissionBody(card);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (allow: boolean, why?: string) => {
    setBusy(true);
    setError(null);
    try {
      await onDecide(allow, why);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <section className="ez-pcard ez-pcard-perm" aria-label={`Approve: ${body.title}`}>
      <header className="ez-pcard-head">
        <strong>
          {agent} wants to {body.title.toLowerCase()}
        </strong>
        {label ? <span className="ez-muted">{label}</span> : null}
      </header>
      {card.description ? <p className="ez-pcard-intro">{card.description}</p> : null}
      {body.lines.map((l) => (
        <div key={l.label ?? "body"}>
          {l.label ? <p className="ez-label">{l.label}</p> : null}
          <pre className="ez-pcard-code">{l.text}</pre>
        </div>
      ))}
      {error ? <p className="ez-pcard-error">{error}</p> : null}
      {denying ? (
        <div className="ez-pcard-reply">
          <textarea
            className="ez-textarea"
            rows={2}
            value={reason}
            placeholder="Why not, or what to do instead"
            aria-label="Reason for denying"
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="ez-pcard-actions">
            <Button variant="danger" size="sm" disabled={busy} onClick={() => decide(false, reason)}>
              Deny
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDenying(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="ez-pcard-actions">
          <Button variant="primary" size="sm" disabled={busy} onClick={() => decide(true)}>
            Allow
          </Button>
          <Button size="sm" disabled={busy} onClick={() => decide(false)}>
            Deny
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setDenying(true)}>
            Deny with a reason
          </Button>
        </div>
      )}
    </section>
  );
}

type Handoff = Extract<AgentEvent, { kind: "handoff" }>;

/**
 * An application's hand-off, when its form reaches the review page: what is attached, what to check before
 * submitting and what was left out. ezapply builds it from the form log; the agent no longer writes it.
 */
export function HandoffView({ handoff: h }: { handoff: Handoff }) {
  const warned = h.steps.filter((s) => s.warnings.length > 0);
  return (
    <section className="ez-pcard ez-handoff" aria-label="Ready to submit">
      <header className="ez-pcard-head">
        <strong>Ready for you to submit</strong>
      </header>
      <p className="ez-pcard-intro">Look over the review page and submit it yourself.</p>
      {h.attached.length ? <HandoffList title="Attached" items={h.attached} /> : null}
      {h.notAttached?.length ? <HandoffList title="Approved but not attached" items={h.notAttached} warn /> : null}
      {h.answersToFlag.length ? (
        <HandoffList
          title="Answers to check"
          items={h.answersToFlag.map((a) => `${a.label ?? a.fieldId}: ${valueText(a.value)} (${a.source})`)}
        />
      ) : null}
      {warned.length ? (
        <HandoffList title="Warnings" items={warned.flatMap((s) => s.warnings.map((w) => `${s.step}: ${w}`))} warn />
      ) : null}
      {h.removed.length ? (
        <HandoffList title="Removed" items={h.removed.map((r) => (r.reason ? `${r.what}: ${r.reason}` : r.what))} />
      ) : null}
    </section>
  );
}

function HandoffList({ title, items, warn }: { title: string; items: string[]; warn?: boolean }) {
  return (
    <div>
      <p className="ez-label">{title}</p>
      <ul className={warn ? "ez-handoff-list ez-handoff-warn" : "ez-handoff-list"}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function valueText(v: unknown): string {
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return typeof v === "string" ? v : JSON.stringify(v);
}

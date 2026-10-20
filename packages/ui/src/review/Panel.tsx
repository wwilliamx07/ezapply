import type { ReviewPageFile } from "@ezapply/protocol";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, Icon } from "../components/ui.js";
import { linkLabel } from "../lib/links.js";
import type { ChangeMark } from "./changes.js";
import type { Decision, DraftComment } from "./draft.js";

/** A web, mail or phone link in the document, with the page it's first on (0-based). */
export interface DocLink {
  url: string;
  page: number;
}

interface Props {
  file: ReviewPageFile;
  /** The document's links; null while the PDF loads or when it can't be read. */
  links: DocLink[] | null;
  /** What changed since the last review; null while the PDF loads or when there's no earlier version to compare. */
  changes: ChangeMark[] | null;
  comments: DraftComment[];
  request: string;
  decision: Decision;
  /** No other document is left to decide: the button sends the answer. */
  last: boolean;
  /** Who the answer goes to ("Claude Code", "Antigravity"). */
  agentName: string;
  sending: boolean;
  active: string | null;
  /** Approve it (unless it asks for changes) and move on to the next document to decide, or send on the last. */
  onAdvance(): void;
  onUndo(): void;
  onRequest(text: string): void;
  onEditComment(id: string, note: string): void;
  onRemoveComment(id: string): void;
  onShow(id: string, page: number): void;
}

export function Panel(props: Props) {
  const { file, changes, comments, decision } = props;
  return (
    <aside className="ez-panel" aria-label={`About ${file.name}`}>
      <div className="ez-panel-head">
        <h2 title={file.name}>{file.name}</h2>
        {decision === "changes" ? (
          <Badge tone="warn">Changes requested</Badge>
        ) : decision === "approved" ? (
          <Badge tone="ok">Approved</Badge>
        ) : (
          <Badge>Not decided</Badge>
        )}
      </div>

      <Checks file={file} />

      {props.links ? (
        <section className="ez-section" aria-labelledby="ez-links">
          <h3 id="ez-links">
            Links {props.links.length ? <span className="ez-count">{props.links.length}</span> : null}
          </h3>
          {props.links.length === 0 ? (
            <p className="ez-help">No web or email links in this document.</p>
          ) : (
            <>
              <p className="ez-help">Kept in the PDF: each opens from here and from the document.</p>
              <ul className="ez-linklist">
                {props.links.map((l) => (
                  <li key={l.url}>
                    <Icon name="link" size={15} />
                    <a href={l.url} target="_blank" rel="noopener noreferrer" title={l.url}>
                      {linkLabel({ url: l.url })}
                    </a>
                    <span className="ez-muted">p. {l.page + 1}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}

      <section className="ez-section" aria-labelledby="ez-since">
        <h3 id="ez-since">Since you last reviewed it</h3>
        <SinceLast file={file} changes={changes} active={props.active} onShow={props.onShow} />
      </section>

      <section className="ez-section" aria-labelledby="ez-comments">
        <h3 id="ez-comments">
          Comments {comments.length ? <span className="ez-count">{comments.length}</span> : null}
        </h3>
        {comments.length === 0 ? (
          <p className="ez-help">Select text in the document, then press Comment to say what should change there.</p>
        ) : (
          <ol className="ez-comments">
            {comments.map((c, i) => (
              <CommentItem
                key={c.id}
                n={i + 1}
                comment={c}
                active={props.active === c.id}
                onShow={() => props.onShow(c.id, c.page - 1)}
                onEdit={(note) => props.onEditComment(c.id, note)}
                onRemove={() => props.onRemoveComment(c.id)}
              />
            ))}
          </ol>
        )}
      </section>

      <section className="ez-section">
        <label className="ez-label" htmlFor={`ez-request-${file.index}`}>
          Anything else to change?
        </label>
        <textarea
          id={`ez-request-${file.index}`}
          className="ez-textarea"
          rows={4}
          value={props.request}
          placeholder="A change to the whole document: tone, length, what to stress."
          onChange={(e) => props.onRequest(e.target.value)}
        />
        <p className="ez-help">
          A comment or anything written here sends the document back to {props.agentName} to revise.
        </p>
      </section>

      {/* Under the edits box, so the decision follows what was just written; it stays at the panel's foot. */}
      <div className="ez-approve">
        {decision === "approved" ? (
          <Button className="ez-btn-undo" onClick={props.onUndo} disabled={props.sending}>
            <Icon name="undo" size={17} /> Undo approval
          </Button>
        ) : null}
        {decision !== "approved" || props.last ? (
          <Button variant="primary" onClick={props.onAdvance} disabled={props.sending}>
            {props.last ? (
              <>
                <Icon name="send" size={17} /> Send to {props.agentName}
              </>
            ) : decision === "changes" ? (
              <>
                <Icon name="send" size={17} /> Request Changes
              </>
            ) : (
              <>
                <Icon name="check" size={17} /> Approve Document
              </>
            )}
          </Button>
        ) : null}
        {props.last ? (
          <p className="ez-help">
            {decision === "open"
              ? "The last document to decide: sending approves it as shown."
              : decision === "changes"
                ? "The last document to decide: sending asks for its changes."
                : "Every document is decided."}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function Checks({ file }: { file: ReviewPageFile }) {
  const info = file.info;
  if (!info) {
    return (
      <ul className="ez-checks">
        <li className="ez-check-danger">
          <Icon name="alert" size={16} /> ezapply couldn't read this file as a PDF.
        </li>
      </ul>
    );
  }
  const over = file.pageLimit !== undefined && info.pages > file.pageLimit;
  return (
    <ul className="ez-checks" aria-label="Checks">
      <li className={over ? "ez-check-warn" : "ez-check-ok"}>
        <Icon name={over ? "alert" : "check"} size={16} />
        {info.pages} {info.pages === 1 ? "page" : "pages"}
        {over ? `, over the ${file.pageLimit}-page limit for a resume` : ""}
        {info.pageSize ? <span className="ez-muted"> · {capitalize(info.pageSize)}</span> : null}
      </li>
      <li className={info.hasTextLayer ? "ez-check-ok" : "ez-check-danger"}>
        <Icon name={info.hasTextLayer ? "check" : "alert"} size={16} />
        {info.hasTextLayer
          ? "Its text can be read by applicant-tracking systems"
          : "No text layer: an applicant-tracking system reads nothing"}
      </li>
      {info.encrypted ? (
        <li className="ez-check-warn">
          <Icon name="alert" size={16} /> Encrypted: some sites refuse encrypted PDFs
        </li>
      ) : null}
    </ul>
  );
}

function SinceLast({
  file,
  changes,
  active,
  onShow,
}: {
  file: ReviewPageFile;
  changes: ChangeMark[] | null;
  active: string | null;
  onShow(id: string, page: number): void;
}) {
  const prev = file.previous;
  if (!prev) return <p className="ez-help">This is the first time you're reviewing it.</p>;
  const when = new Date(prev.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const then = prev.approved ? "approved it" : "asked for changes";
  if (prev.same) {
    return (
      <p className="ez-help">
        Unchanged since you {then} ({when}).
      </p>
    );
  }
  if (!prev.pages)
    return (
      <p className="ez-help">
        Changed since you {then} ({when}); its text then wasn't kept.
      </p>
    );
  if (!changes) return <p className="ez-help">Comparing with the version from {when}…</p>;
  if (changes.length === 0) {
    return (
      <p className="ez-help">
        Rebuilt since you {then} ({when}), with the same text. Check the layout.
      </p>
    );
  }
  return (
    <>
      <p className="ez-help">
        You {then} on {when}. {changes.length} {changes.length === 1 ? "change" : "changes"} since:
      </p>
      <ol className="ez-changes">
        {changes.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={`ez-change${active === c.id ? " ez-change-active" : ""}`}
              onClick={() => onShow(c.id, c.change.page - 1)}
            >
              <span className="ez-change-page">p. {c.change.page}</span>
              <span className="ez-change-text">
                {c.change.removed ? <del>{clip(c.change.removed)}</del> : null}
                {c.change.removed && c.change.added ? " " : null}
                {c.change.added ? <ins>{clip(c.change.added)}</ins> : null}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

function CommentItem({
  n,
  comment,
  active,
  onShow,
  onEdit,
  onRemove,
}: {
  n: number;
  comment: DraftComment;
  active: boolean;
  onShow(): void;
  onEdit(note: string): void;
  onRemove(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(comment.note);
  const ref = useRef<HTMLLIElement>(null);
  // Into view within the panel only: `scrollIntoView` would scroll the page too, pulling it away from the viewer
  // whenever a comment is added or its highlight pressed (on a narrow window the panel is under the viewer).
  useEffect(() => {
    if (active && ref.current) scrollWithin(ref.current);
  }, [active]);
  return (
    <li ref={ref} className={`ez-comment${active ? " ez-comment-active" : ""}`}>
      <button type="button" className="ez-comment-quote" onClick={onShow} title="Show it in the document">
        <span className="ez-mark-n" aria-hidden="true">
          {n}
        </span>
        <span>
          <span className="ez-sr-only">
            Comment {n} on page {comment.page}:{" "}
          </span>
          “{clip(comment.quote, 120)}”
        </span>
      </button>
      {editing ? (
        <>
          <textarea
            className="ez-textarea"
            rows={3}
            value={note}
            aria-label={`Comment ${n}`}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="ez-row-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setNote(comment.note);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!note.trim()}
              onClick={() => {
                onEdit(note.trim());
                setEditing(false);
              }}
            >
              Save
            </Button>
          </div>
        </>
      ) : (
        <div className="ez-comment-body">
          <p>{comment.note}</p>
          <span className="ez-comment-actions">
            <Button size="icon" variant="ghost" onClick={() => setEditing(true)} aria-label={`Edit comment ${n}`}>
              <Icon name="edit" size={15} />
            </Button>
            <Button size="icon" variant="ghost" onClick={onRemove} aria-label={`Remove comment ${n}`}>
              <Icon name="trash" size={15} />
            </Button>
          </span>
        </div>
      )}
    </li>
  );
}

/** Scroll the panel, when it scrolls on its own, just enough to show `el`; nothing else moves. */
function scrollWithin(el: HTMLElement) {
  const panel = el.closest<HTMLElement>(".ez-panel");
  if (!panel || panel.scrollHeight <= panel.clientHeight) return;
  const box = panel.getBoundingClientRect();
  // The decision bar stays at the panel's foot, over what scrolls under it.
  const bottom = box.bottom - (panel.querySelector<HTMLElement>(".ez-approve")?.offsetHeight ?? 0);
  const r = el.getBoundingClientRect();
  const by = r.top < box.top ? r.top - box.top : r.bottom > bottom ? r.bottom - bottom : 0;
  if (by) panel.scrollBy({ top: by, behavior: "smooth" });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function clip(s: string, n = 90): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

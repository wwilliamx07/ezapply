import type { ReviewAnswer, ReviewPageFile, ReviewPageState } from "@ezapply/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Banner, Brand, Icon, MessagePage, Spinner } from "../components/ui.js";
import { ApiError, getJson, OfflineError, pageBase, postJson, subscribe } from "../lib/api.js";
import { type LoadedPdf, loadPdf } from "../lib/pdf.js";
import { changesSince } from "./changes.js";
import { answerOf, type Decision, type DocDraft, decisionOf, useDrafts } from "./draft.js";
import { type DocLink, Panel } from "./Panel.js";
import { type Jump, type Selected, Viewer } from "./Viewer.js";

/**
 * The review page: the documents Claude prepared for one application, each to approve as shown or to send back
 * with comments on passages and a request for the whole. Each is approved on its own, by one button that also moves
 * on to the next document to decide, and on the last sends the answer. The companion keeps the bytes shown here, and
 * approving records exactly those.
 */
export function ReviewApp() {
  const base = useMemo(pageBase, []);
  const [state, setState] = useState<ReviewPageState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [selected, setSelected] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const [jump, setJump] = useState<Jump | null>(null);
  const [showChanges, setShowChanges] = useState(true);
  const [pdfs, setPdfs] = useState<Record<number, LoadedPdf | Error>>({});
  const loading = useRef(new Set<number>());
  const { draftOf, update, forget } = useDrafts(state?.id ?? null);

  const refresh = useCallback(async () => {
    try {
      setState(await getJson<ReviewPageState>(`${base}/state`));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof OfflineError ? e.message : "This review couldn't be loaded.");
    }
  }, [base]);

  useEffect(() => {
    void refresh();
    return subscribe(`${base}/events`, { state: () => void refresh() });
  }, [base, refresh]);

  const file = state?.files[selected];
  useEffect(() => {
    if (!file?.info || loading.current.has(file.index)) return;
    loading.current.add(file.index);
    const index = file.index;
    loadPdf(`${base}/file/${index}`).then(
      (pdf) => setPdfs((all) => ({ ...all, [index]: pdf })),
      (err) => setPdfs((all) => ({ ...all, [index]: err instanceof Error ? err : new Error(String(err)) })),
    );
  }, [file, base]);

  const pdf = file ? pdfs[file.index] : undefined;
  const changes = useMemo(() => {
    const prev = file?.previous;
    if (!prev?.pages || prev.same || !pdf || pdf instanceof Error) return null;
    return changesSince(
      prev.pages,
      pdf.pages.map((p) => p.text),
    );
  }, [file, pdf]);

  // The document's web, mail and phone links, each once, with the first page it's on.
  const links = useMemo<DocLink[] | null>(() => {
    if (!pdf || pdf instanceof Error) return null;
    const seen = new Map<string, DocLink>();
    pdf.pages.forEach((p, page) => {
      for (const l of p.links) if (l.url && !seen.has(l.url)) seen.set(l.url, { url: l.url, page });
    });
    return [...seen.values()];
  }, [pdf]);

  const show = useCallback((id: string, page: number) => {
    setActive(id);
    setJump({ id, page, nonce: Date.now() });
  }, []);

  if (sent) {
    return (
      <MessagePage title="Sent to Claude">
        <p>You can close this tab. Claude has your answer and will show you any revised documents.</p>
      </MessagePage>
    );
  }
  if (!state) {
    return loadError ? (
      <MessagePage title="This review isn't available">
        <p>{loadError}</p>
      </MessagePage>
    ) : (
      <div className="ez-loading">
        <Spinner label="Loading the review" />
      </div>
    );
  }
  if (state.status === "answered" && state.answer) {
    return (
      <MessagePage title="Already answered">
        <AnswerSummary answer={state.answer} />
        <p className="ez-muted">You can close this tab.</p>
      </MessagePage>
    );
  }
  if (state.status === "replaced") {
    return (
      <MessagePage title="A newer version is waiting">
        <p>Claude opened a newer review of these documents in another tab. Use that one.</p>
      </MessagePage>
    );
  }
  if (state.status === "expired") {
    return (
      <MessagePage title="This review expired">
        <p>Ask Claude to show the documents again.</p>
      </MessagePage>
    );
  }

  const draft = file ? draftOf(file.index) : { request: "", comments: [] };
  const decisions = state.files.map((f) => decisionOf(draftOf(f.index)));
  const approved = decisions.filter((d) => d === "approved").length;
  const changed = decisions.filter((d) => d === "changes").length;
  const open = decisions.filter((d) => d === "open").length;
  // Asking for changes takes back an approval, so removing them later leaves the document undecided, not approved.
  const edit = (index: number, change: (d: DocDraft) => DocDraft) =>
    update(index, (d) => ({ ...change(d), approved: false }));
  // The next document still to decide, after this one and then from the top.
  const nextOpen = (index: number) =>
    [...decisions.keys()]
      .map((k) => (index + 1 + k) % decisions.length)
      .find((k) => k !== index && decisions[k] === "open");
  // The panel's one button: approve the document (unless it asks for changes), then on to the next document to
  // decide; with none left, the answer goes.
  const advance = (index: number) => {
    if (decisions[index] === "open") update(index, (d) => ({ ...d, approved: true }));
    const next = nextOpen(index);
    if (next === undefined) return void send();
    setSelected(next);
    setActive(null);
    // Below 900 px the page scrolls and the button sits under the viewer: back up to the next document's start.
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const send = async () => {
    setSending(true);
    setSendError(null);
    try {
      const res = await postJson(`${base}/answer`, answerOf(state.files.length, draftOf));
      if (res.status === 204) {
        forget();
        setSent(true);
        // A tab the companion opened has only this page in its history, so the browser lets it close itself.
        window.close();
        return;
      }
      if (res.status === 409) return void (await refresh());
      throw new ApiError(res.status, null);
    } catch (e) {
      setSendError(e instanceof OfflineError ? e.message : "Your answer wasn't taken. Try again.");
    } finally {
      setSending(false);
    }
  };

  const title = [state.posting.role, state.posting.company].filter(Boolean).join(" at ");
  return (
    <div className="ez-review">
      <header className="ez-topbar">
        <Brand />
        <div className="ez-topbar-title">
          <h1>Review before attaching</h1>
          {title ? <span className="ez-muted">{title}</span> : null}
        </div>
      </header>

      <nav className="ez-docs" aria-label="Documents">
        <p className="ez-help ez-docs-intro">
          Approve each document as shown, or say what should change. Claude revises it and shows you the new version.
        </p>
        <ul>
          {state.files.map((f) => (
            <li key={f.index}>
              <DocButton
                file={f}
                selected={f.index === selected}
                decision={decisions[f.index] ?? "open"}
                onSelect={() => {
                  setSelected(f.index);
                  setActive(null);
                }}
              />
            </li>
          ))}
        </ul>
      </nav>

      <main className="ez-main">
        {!file ? null : !file.info ? (
          <div className="ez-center">
            <Banner tone="danger" icon={<Icon name="alert" />}>
              ezapply couldn't read {file.name} as a PDF. Ask Claude to build it again.
            </Banner>
          </div>
        ) : !pdf ? (
          <div className="ez-center">
            <Spinner label={`Loading ${file.name}`} />
          </div>
        ) : pdf instanceof Error ? (
          <div className="ez-center">
            <Banner tone="danger" icon={<Icon name="alert" />}>
              {file.name} couldn't be shown: {pdf.message}
            </Banner>
          </div>
        ) : (
          <Viewer
            key={file.index}
            pdf={pdf}
            name={file.name}
            downloadUrl={`${base}/file/${file.index}?download=1`}
            changes={changes ?? []}
            showChanges={showChanges}
            onToggleChanges={changes?.length ? () => setShowChanges((v) => !v) : null}
            comments={draft.comments.map((c, i) => ({ id: c.id, n: i + 1, page: c.page - 1, rects: c.rects }))}
            active={active}
            jump={jump}
            onActivate={setActive}
            onComment={(sel: Selected, note: string) => {
              const id = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
              edit(file.index, (d) => ({
                ...d,
                comments: [...d.comments, { id, page: sel.page + 1, quote: sel.quote, note, rects: sel.rects }],
              }));
              setActive(id);
            }}
          />
        )}
      </main>

      {file ? (
        <Panel
          key={file.index}
          file={file}
          links={links}
          changes={changes}
          comments={draft.comments}
          request={draft.request}
          decision={decisions[file.index] ?? "open"}
          last={nextOpen(file.index) === undefined}
          sending={sending}
          active={active}
          onAdvance={() => advance(file.index)}
          onUndo={() => update(file.index, (d) => ({ ...d, approved: false }))}
          onRequest={(request) => edit(file.index, (d) => ({ ...d, request }))}
          onEditComment={(id, note) =>
            edit(file.index, (d) => ({ ...d, comments: d.comments.map((c) => (c.id === id ? { ...c, note } : c)) }))
          }
          onRemoveComment={(id) => edit(file.index, (d) => ({ ...d, comments: d.comments.filter((c) => c.id !== id) }))}
          onShow={(id, page) => {
            setShowChanges(true);
            show(id, page);
          }}
        />
      ) : null}

      <footer className="ez-footer">
        <div className="ez-footer-summary" aria-live="polite">
          {approved > 0 ? <Badge tone="ok">{approved} approved</Badge> : null}
          {changed > 0 ? <Badge tone="warn">{changed} with changes</Badge> : null}
          {open > 0 ? <Badge>{open} to decide</Badge> : null}
          {sending ? <Spinner label="Sending to Claude" /> : null}
          {sendError ? <span className="ez-footer-error">{sendError}</span> : null}
        </div>
      </footer>
    </div>
  );
}

function DocButton({
  file,
  selected,
  decision,
  onSelect,
}: {
  file: ReviewPageFile;
  selected: boolean;
  decision: Decision;
  onSelect(): void;
}) {
  const prev = file.previous;
  const pages = file.info ? `${file.info.pages} ${file.info.pages === 1 ? "page" : "pages"}` : "Unreadable";
  return (
    <button
      type="button"
      className={`ez-doc${selected ? " ez-doc-selected" : ""}`}
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
    >
      <Icon name="file" size={20} />
      <span className="ez-doc-text">
        <span className="ez-doc-name">{file.name}</span>
        <span className="ez-doc-meta">
          {pages}
          {prev && !prev.same ? " · changed since last review" : ""}
        </span>
      </span>
      {decision === "changes" ? (
        <Badge tone="warn">Changes</Badge>
      ) : decision === "approved" ? (
        <Badge tone="ok">Approved</Badge>
      ) : (
        <Badge>To decide</Badge>
      )}
    </button>
  );
}

function AnswerSummary({ answer }: { answer: ReviewAnswer }) {
  return (
    <>
      {answer.approved.length ? (
        <>
          <p>Approved, attached as shown:</p>
          <ul>
            {answer.approved.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </>
      ) : null}
      {answer.changes.length ? (
        <>
          <p>Changes asked for (Claude will show you the revised version):</p>
          <ul>
            {answer.changes.map((c) => (
              <li key={c.file}>
                {c.file}
                {c.comments?.length
                  ? ` (${c.comments.length} ${c.comments.length === 1 ? "comment" : "comments"})`
                  : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

import {
  AgentEffort,
  type AgentEvent,
  AgentKind,
  AgentModel,
  AgentPermissionMode,
  type AgentPrefs,
  type AgentSettings,
  type Card,
  type ConversationPart,
  changeAgentPrefs,
  conversationKey,
  effectiveSettings,
  GENERAL_CONVERSATION,
  type PanelConversation,
  type PanelPosting,
  type PanelState,
  type PanelTab,
  type PostingStatus,
  postingConversation,
} from "@ezapply/protocol";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Banner, Brand, Button, Icon } from "../components/ui.js";
import { AskCardView, PermissionCardView } from "./cards.js";
import { Markdown } from "./markdown.js";
import type { ConnectionState, PanelTransport } from "./transport.js";

/** What each button asks, in words: the same as typing it, so the skills pick the request up either way. */
export const REQUESTS = {
  tailor:
    "Tailor my resume for this posting, and write the cover letter if the posting or my preferences call for one.",
  resume: "Tailor my resume for this posting.",
  cover: "Write a cover letter for this posting.",
  bundle: "Put this posting's documents in one PDF, as its application requirements ask.",
  fill: (tabId: number) => `Fill out the application for this posting in the open tab (tabId ${tabId}).`,
};

type TabInfo = (PanelTab & { tabId: number }) | null;

/** The permission modes as the panel names them, and what each does (the select's title). */
const MODES: Record<AgentPermissionMode, { label: string; what: string }> = {
  default: {
    label: "Ask first",
    what: "Claude asks on the panel before commands and edits the workspace doesn't allow",
  },
  acceptEdits: { label: "Accept edits", what: "File edits go ahead without asking; commands still ask" },
  auto: { label: "Auto", what: "Claude Code decides what's safe to run without asking, and asks for the rest" },
  plan: { label: "Plan only", what: "Claude reads and plans, and changes nothing" },
  dontAsk: { label: "Don't ask", what: "Only what the workspace allows runs; anything else is denied without asking" },
};
/** Antigravity's modes: headless, nobody can approve a call, so it runs every call unasked, or only plans. */
const ANTIGRAVITY_MODES: Partial<Record<AgentPermissionMode, { label: string; what: string }>> = {
  dontAsk: { label: "Don't ask", what: "Antigravity runs its commands and edits without asking" },
  plan: { label: "Plan only", what: "Antigravity reads and plans, and changes nothing" },
};
const AGENTS: Record<AgentKind, string> = { claude: "Claude Code", antigravity: "Antigravity" };
const MODELS: Record<AgentModel, string> = {
  fable: "Fable",
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};
const EFFORTS: Record<AgentEffort, string> = {
  low: "Low effort",
  medium: "Medium effort",
  high: "High effort",
  xhigh: "Extra high effort",
  max: "Max effort",
};

/** A posting's two conversations, as the panel's switch names them. */
const PARTS: Record<ConversationPart, { label: string; what: string }> = {
  tailor: { label: "Documents", what: "The conversation that tailors this posting's documents" },
  fill: { label: "Application", what: "The conversation that fills this posting's application" },
};

/**
 * The extension's side panel: everything the user does with ezapply after setup ("Everything in the browser"). It
 * opens on the list of applications, grouped by what each needs; opening one shows one of its conversations with the
 * agent (its documents' or its application's), its documents and what the current tab is, the cards waiting on the
 * user there, and a chat bar; the buttons send the same requests typing would, each to its own conversation.
 */
export function PanelApp({ transport }: { transport: PanelTransport }) {
  const [conn, setConn] = useState<ConnectionState>({ state: "connecting" });
  const [state, setState] = useState<PanelState | null>(null);
  /** The posting opened in the panel; null is the general conversation. */
  const [picked, setPicked] = useState<string | null>(null);
  /** The posting's conversation picked in the panel; null shows the one Claude works in, else its documents'. */
  const [part, setPart] = useState<ConversationPart | null>(null);
  const [conv, setConv] = useState<PanelConversation | null>(null);
  const [tab, setTab] = useState<TabInfo>(null);
  /** The list of applications is showing, rather than one application's conversation. */
  const [home, setHome] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const postingId = picked ?? GENERAL_CONVERSATION;
  const busy = busyConversations(state);
  const running = busy.map((c) => postingConversation(c.conversation)).find((c) => c?.postingId === postingId);
  const shownPart = part ?? running?.part ?? "tailor";
  const selected = postingId === GENERAL_CONVERSATION ? postingId : conversationKey(postingId, shownPart);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const postingRef = useRef(postingId);
  postingRef.current = postingId;

  const fail = useCallback((err: unknown) => setError((err as Error).message ?? String(err)), []);
  /** The agent settings, from the extension's storage: there at once, before ezapply answers. */
  const [prefs, setPrefs] = useState<AgentPrefs | null>(null);
  const refreshState = useCallback(async () => {
    setState(await transport.call("panel.state", {}));
  }, [transport]);
  const refreshConv = useCallback(async () => {
    const key = selectedRef.current;
    const next = await transport.call("panel.conversation", { key });
    if (selectedRef.current === key) setConv(next);
  }, [transport]);
  const refreshTab = useCallback(async () => {
    const shown = postingRef.current;
    const next = await transport.tab(shown === GENERAL_CONVERSATION ? undefined : shown).catch(() => null);
    // An answer for a posting no longer shown would say what the tab is to the wrong one.
    if (postingRef.current === shown) setTab(next);
  }, [transport]);
  const refreshAll = useCallback(() => {
    void refreshState().catch(fail);
    void refreshConv().catch(fail);
    void refreshTab();
  }, [refreshState, refreshConv, refreshTab, fail]);

  useEffect(() => {
    const stop = transport.subscribe((push) => {
      if (push.type === "connection") {
        setConn(push.state);
        if (push.state.state === "connected") refreshAll();
      } else if (push.type === "tab") void refreshTab();
      else if (push.type === "prefs") setPrefs(push.prefs);
      else if (push.update.event && push.update.event.conversation === selectedRef.current) {
        const event = push.update.event.event;
        setConv((c) => (c ? { ...c, events: withEvent(c.events, event) } : c));
        if (event.kind === "turnEnd" || event.kind === "toolDone") void refreshConv().catch(() => {});
      } else if (push.update.changed) {
        void refreshState().catch(fail);
        void refreshConv().catch(fail);
      }
    });
    void transport.connection().then((c) => {
      setConn(c);
      if (c.state === "connected") refreshAll();
    });
    void transport.prefs().then(setPrefs, fail);
    return stop;
  }, [transport, refreshAll, refreshTab, refreshState, refreshConv, fail]);

  // A different conversation picked.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `selected` is what triggers the read
  useEffect(() => {
    if (conn.state === "connected") {
      setConv(null);
      void refreshConv().catch(fail);
      void refreshTab();
    }
  }, [selected]);

  const connected = conn.state === "connected" && state !== null;
  const agent = state?.agent;
  // Before ezapply says which agents are installed, the chosen one is taken to be.
  const installed = agent?.agents ?? (prefs ? [prefs.agent] : []);
  const settings = prefs ? effectiveSettings(prefs, installed) : null;
  /** The agent in use, as the panel's lines name it ("Antigravity is working…"). */
  const agentName = AGENTS[settings?.agent ?? "claude"];
  const changeSettings = (change: Partial<AgentSettings>) => {
    if (!prefs) return;
    const next = changeAgentPrefs(prefs, installed, change);
    setPrefs(next);
    // The background gives them to ezapply.
    void transport.savePrefs(next).catch(fail);
  };
  /** An agent works (or is starting) in this conversation; the others run on their own. */
  const isBusy = (key: string) => busy.some((c) => c.conversation === key);
  const workingHere = isBusy(selected);
  const postingBusy = busy.some((c) => ownerOf(c.conversation) === postingId);
  const posting = conv?.posting;
  const labelOf = useMemo(() => labeller(state?.postings ?? []), [state?.postings]);

  /**
   * A message on its way: from the press until the agent's state says it's working (or the send failed), whatever
   * starts a turn is disabled. The ref holds it at once, so a second press before the panel draws again is refused
   * too, rather than queueing a second message.
   */
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const send = async (text: string, key = selected) => {
    if (sendingRef.current) throw new Error("A message is already on its way.");
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      await transport.call("panel.send", { key, text });
      // The companion marks the agent working before it answers, so the state read now keeps the buttons disabled.
      await refreshState().catch(() => {});
    } catch (err) {
      fail(err);
      throw err;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  const capture = () => {
    setError(null);
    // Called inside the click: access to websites can be asked for only during the gesture.
    void transport.capture().then((r) => {
      if (!r.ok) setError(r.error);
      else {
        setPicked(r.postingId);
        setPart(null);
        setHome(false);
      }
    });
  };
  /** A request from a button: to the posting's conversation for it, which the panel then shows. */
  const request = (to: ConversationPart, text: string) => {
    setPart(to);
    void send(text, conversationKey(postingId, to)).catch(() => {});
  };
  const pick = (key: string) => {
    setPicked(key);
    setPart(null);
    setHome(false);
  };
  const general = selected === GENERAL_CONVERSATION;
  const resetWhat = general
    ? "a new general conversation"
    : `a new ${PARTS[shownPart].label.toLowerCase()} conversation for this posting`;
  const reset = async () => {
    if (!window.confirm(`Start ${resetWhat}? ${agentName} forgets this one; the files stay.`)) return;
    await transport.call("panel.reset", { key: selected }).catch(fail);
    await refreshConv().catch(fail);
  };
  const deletePosting = async () => {
    if (!posting) return;
    const name = labelOf(posting.id);
    if (
      !window.confirm(
        `Delete ${name} for good? Its folder goes: the capture, notes, documents and form log, and its conversation.`,
      )
    )
      return;
    try {
      await transport.call("panel.deletePosting", { postingId: posting.id });
      setPicked(null);
      setPart(null);
      setHome(true);
      await refreshState();
    } catch (err) {
      fail(err);
    }
  };
  /**
   * Submitted: when the extension missed the confirmation page (the tab closed first, a page it didn't recognise).
   * Open: when it took a page for one, or the click went astray.
   */
  const markSubmitted = async (submitted: boolean) => {
    if (!posting) return;
    try {
      await transport.call(submitted ? "panel.markSubmitted" : "panel.markOpen", { postingId: posting.id });
      await refreshState();
      await refreshConv();
    } catch (err) {
      fail(err);
    }
  };
  const deleteDocument = async (file: string) => {
    if (!window.confirm(`Delete ${file} for good? Its LaTeX source stays, so ${agentName} can build it again.`)) return;
    await transport.call("panel.deleteDocument", { postingId, file }).catch(fail);
    await refreshConv().catch(fail);
  };

  // A menu or the posting popover closes when the user clicks anywhere else.
  useEffect(() => {
    const close = (e: MouseEvent) => {
      for (const d of document.querySelectorAll<HTMLDetailsElement>(
        "details.ez-panel-menu[open], details.ez-split-menu[open]",
      ))
        if (!d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  // A new card brings the "Needs you" cards, at the conversation's end, into view.
  const needsRef = useRef<HTMLElement>(null);
  const cardIds = (state?.cards ?? []).map((c) => c.id).join(",");
  useEffect(() => {
    if (cardIds) needsRef.current?.scrollIntoView?.({ block: "start" });
  }, [cardIds]);

  /** Why a request to a conversation can't start now: a message on its way, or the agent working in it. */
  const busyWhy = (key: string) =>
    sending ? "Sending…" : isBusy(key) ? `${agentName} is working on this: wait, or Stop it` : undefined;
  /** Stop every conversation the agent works in for an application (or the general one). */
  const stopApplication = (key: string) => {
    for (const c of busy.filter((b) => ownerOf(b.conversation) === key))
      void transport.call("panel.stop", { key: c.conversation }).catch(fail);
  };
  const list = state ? applications(state, agentName) : null;
  // An application shows its own cards and a terminal chat's; another's wait for it on the list, and a line says so.
  const cards = (state?.cards ?? []).filter((c) => !c.conversation || (!home && ownerOf(c.conversation) === postingId));
  const elsewhere = list ? [...list.rows, list.general].filter((r) => r.group === "needs" && r.key !== postingId) : [];
  const docCount = conv?.documents.length ?? 0;
  const waiting = conv?.documents.filter((d) => !isApproved(d.state)).length ?? 0;

  return (
    <div className="ez-panel">
      <header className="ez-panel-head">
        {home ? (
          <>
            <Brand />
            <StatusDot conn={conn} />
            <h1 className="ez-panel-title">Applications</h1>
            {/* On the list: it adds an application to it, and opens it. */}
            <Button
              size="sm"
              className="ez-panel-capture"
              disabled={!connected}
              onClick={capture}
              title={
                tab?.kind === "posting"
                  ? "Capture this posting's page again"
                  : "Capture the page in this tab as a posting, and open it"
              }
            >
              <Icon name="plus" size={14} /> Capture
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="ez-btn-icon"
              aria-label="All applications"
              title="All applications"
              onClick={() => setHome(true)}
            >
              <Icon name="chevronLeft" />
            </Button>
            <StatusDot conn={conn} />
            <div className="ez-panel-heading">
              <div className="ez-panel-role">
                {posting ? (posting.role ?? posting.company ?? posting.id) : "General"}
              </div>
              <div className="ez-muted">
                {posting
                  ? [posting.company, siteLabel(posting.site)].filter(Boolean).join(" · ")
                  : "Not about a posting"}
              </div>
            </div>
          </>
        )}
        {/* The general conversation has no posting or documents: its one action, Reset, is a button of its own. */}
        {!home && general ? (
          <Button
            size="sm"
            variant="ghost"
            className="ez-btn-icon"
            aria-label="Reset conversation"
            title={resetWhat.charAt(0).toUpperCase() + resetWhat.slice(1)}
            disabled={!connected}
            onClick={reset}
          >
            <Icon name="reset" />
          </Button>
        ) : null}
        <details className="ez-panel-menu ez-panel-details" hidden={home || general}>
          <summary
            aria-label={`Posting and documents${waiting ? `, ${waiting} waiting for your review` : ""}`}
            title="The posting and its documents"
            className="ez-btn ez-btn-ghost ez-btn-icon"
          >
            <Icon name="file" />
            {docCount ? <span className={waiting ? "ez-count ez-count-warn" : "ez-count"}>{docCount}</span> : null}
          </summary>
          <div className="ez-panel-menu-items ez-panel-pop">
            {posting ? (
              <section className="ez-panel-posting" aria-label="Posting">
                <div className="ez-panel-role">{posting.role ?? posting.id}</div>
                <div className="ez-muted">
                  {[posting.company, siteLabel(posting.site), posting.deadline ? `due ${posting.deadline}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {posting.requirements.length > 0 ? (
                  <div className="ez-chips">
                    {posting.requirements.map((r) => (
                      <span key={r} className="ez-chip">
                        {r}
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
            {conv && conv.documents.length > 0 ? (
              <section className="ez-panel-docs" aria-label="Documents">
                <p className="ez-label">Documents</p>
                {conv.documents.map((d) => (
                  <div key={d.file} className="ez-panel-doc">
                    <button
                      type="button"
                      className="ez-linklike"
                      onClick={() =>
                        void transport.call("panel.open", { what: "file", postingId, file: d.file }).catch(fail)
                      }
                    >
                      <Icon name="file" size={15} /> {d.file}
                    </button>
                    <DocState state={d.state} />
                    {isApproved(d.state) ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ez-btn-icon ez-panel-danger"
                        aria-label={`Delete ${d.file}`}
                        title={`Delete ${d.file}`}
                        disabled={!connected}
                        onClick={() => void deleteDocument(d.file)}
                      >
                        <Icon name="trash" size={15} />
                      </Button>
                    ) : null}
                    {d.state === "review" && conv.review ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void transport
                            .call("panel.open", { what: "review", reviewId: conv.review?.reviewId as string })
                            .catch(fail)
                        }
                      >
                        Review
                      </Button>
                    ) : null}
                  </div>
                ))}
              </section>
            ) : posting ? (
              <p className="ez-muted ez-panel-nodocs">No documents yet.</p>
            ) : null}
            {posting ? (
              <div className="ez-panel-pop-actions">
                {posting.status !== "submitted" && posting.status !== "archived" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!connected}
                    onClick={() => void markSubmitted(true)}
                    title="You submitted this application: move it to Done"
                  >
                    Mark submitted
                  </Button>
                ) : null}
                {posting.status === "submitted" ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!connected}
                    onClick={() => void markSubmitted(false)}
                    title="This application isn't submitted: move it back to Open"
                  >
                    Mark open
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!connected}
                  className="ez-panel-danger"
                  onClick={reset}
                  title={resetWhat.charAt(0).toUpperCase() + resetWhat.slice(1)}
                >
                  Reset Conversation
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!connected || postingBusy}
                  className="ez-panel-danger"
                  onClick={() => void deletePosting()}
                  title={
                    postingBusy
                      ? `${agentName} is working on this posting: wait, or Stop it`
                      : "Delete this posting and everything in its folder"
                  }
                >
                  Delete posting
                </Button>
              </div>
            ) : null}
          </div>
        </details>
        <details className="ez-panel-menu">
          <summary aria-label="Menu" className="ez-btn ez-btn-ghost ez-btn-icon">
            <Icon name="menu" />
          </summary>
          <div className="ez-panel-menu-items">
            <button
              type="button"
              disabled={!connected}
              onClick={() => void transport.call("panel.open", { what: "setup" }).catch(fail)}
            >
              Setup
            </button>
            <button type="button" onClick={() => void transport.openSettings().catch(fail)}>
              Extension settings
            </button>
          </div>
        </details>
      </header>

      <Blocker conn={conn} />
      {connected && state && !state.setup.ready ? (
        <Banner tone="warn">
          Setup isn't finished: {state.setup.left.join(", ") || "some steps are left"}.{" "}
          <Button size="sm" onClick={() => void transport.call("panel.open", { what: "setup" }).catch(fail)}>
            Continue setup
          </Button>
        </Banner>
      ) : null}
      {error ? (
        <Banner tone="danger">
          {error}{" "}
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </Banner>
      ) : null}

      {!home && elsewhere[0] ? (
        <button
          type="button"
          className="ez-panel-elsewhere"
          onClick={() => (elsewhere.length === 1 && elsewhere[0] ? pick(elsewhere[0].key) : setHome(true))}
        >
          <span className="ez-dot ez-dot-warn" aria-hidden="true" />
          {elsewhere.length === 1
            ? `${elsewhere[0].title} needs you`
            : `${elsewhere.length} other applications need you`}
          <Icon name="chevronRight" size={15} />
        </button>
      ) : null}

      {posting && !home ? (
        <div className="ez-panel-parts" role="tablist" aria-label="Conversation">
          {(Object.keys(PARTS) as ConversationPart[]).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={p === shownPart}
              className={p === shownPart ? "ez-panel-part ez-panel-part-on" : "ez-panel-part"}
              title={PARTS[p].what}
              onClick={() => setPart(p)}
            >
              {PARTS[p].label}
              {isBusy(conversationKey(postingId, p)) ? (
                <span className="ez-dot ez-dot-ok" role="img" aria-label={`${agentName} is working here`} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {home && list ? (
        <div className={connected ? "ez-general" : "ez-general ez-panel-off"} aria-disabled={!connected}>
          <GeneralCard general={list.general} onOpen={pick} onStop={stopApplication} />
        </div>
      ) : null}

      {/* Only the conversation scrolls: the buttons and the chat box stay put below it, however long it gets. */}
      <div className={connected ? "ez-panel-body" : "ez-panel-body ez-panel-off"} aria-disabled={!connected}>
        {home ? (
          list ? (
            <Applications list={list} onOpen={pick} onStop={stopApplication} />
          ) : null
        ) : (
          <Conversation events={conv?.events ?? []} agent={agentName} />
        )}
        {cards.length > 0 ? (
          <section className="ez-panel-needs" aria-label="Needs you" ref={needsRef}>
            <p className="ez-label">Needs you · {cards.length}</p>
            {cards.map((c) => (
              <CardView
                key={c.id}
                card={c}
                label={
                  c.conversation === selected
                    ? undefined
                    : c.conversation
                      ? labelOf(c.conversation)
                      : "From a terminal chat"
                }
                transport={transport}
                fail={fail}
              />
            ))}
          </section>
        ) : null}
      </div>

      <footer className="ez-panel-foot">
        {/* On the list, only what applies to every conversation: the agent's line and its settings. */}
        {tab && !home ? (
          <p className={`ez-panel-tab ez-panel-tab-${tab.kind}`}>
            <Icon name={tab.kind === "application" || tab.kind === "posting" ? "check" : "info"} size={15} /> This tab:{" "}
            {tab.text}
          </p>
        ) : null}
        {home ? null : (
          <div className={connected ? "ez-panel-actions" : "ez-panel-actions ez-panel-off"}>
            <TailorButton
              disabled={!connected || !posting || sending || isBusy(conversationKey(postingId, "tailor"))}
              why={!posting ? "Capture a posting first" : busyWhy(conversationKey(postingId, "tailor"))}
              onPick={(text) => request("tailor", text)}
            />
            <FillButton
              disabled={!connected || !posting || sending || isBusy(conversationKey(postingId, "fill"))}
              why={!posting ? "Capture a posting first" : busyWhy(conversationKey(postingId, "fill"))}
              tab={tab}
              application={posting?.application}
              onFill={(tabId) => request("fill", REQUESTS.fill(tabId))}
              onOpen={(url) => void transport.openTab(url).catch(fail)}
            />
          </div>
        )}
        <AgentLine state={state} name={agentName} selected={selected} labelOf={labelOf} />
        {home ? null : (
          <ChatBar
            disabled={!connected || agent?.status === "unavailable"}
            working={workingHere}
            sending={sending}
            onSend={send}
            onStop={() => void transport.call("panel.stop", { key: selected }).catch(fail)}
          />
        )}
        <div className="ez-panel-settings">
          {settings ? (
            <AgentSettingsBar
              settings={settings}
              agents={installed}
              antigravityModels={agent?.models.antigravity}
              disabled={agent?.status === "unavailable"}
              onChange={changeSettings}
            />
          ) : null}
          {!home && conv?.totalCostUsd !== undefined ? (
            <p className="ez-panel-cost" title="What this conversation has cost so far">
              ${conv.totalCostUsd.toFixed(2)}
            </p>
          ) : null}
        </div>
      </footer>
    </div>
  );
}

/** The list's groups, in order: what waits on the user first, then what the agent is doing, then the rest. */
const GROUPS = { needs: "Needs you", working: "Working", open: "Open", done: "Done" } as const;
type Group = keyof typeof GROUPS;
/** One application on the list (or the general conversation): its line, and what it's doing or where it stands. */
interface ApplicationRow {
  /** The posting's id, or the general conversation's key. */
  key: string;
  title: string;
  sub: string;
  what: string;
  group: Group;
}
const STANDING: Record<PostingStatus, string> = {
  captured: "Captured",
  drafting: "Documents in progress",
  attached: "Documents attached",
  filled: "Filled, not submitted",
  submitted: "Submitted",
  archived: "Archived",
};

/** The list entry a conversation belongs to: its posting's id, or the general conversation; none for a terminal chat. */
export function ownerOf(key: string | undefined): string | null {
  if (!key) return null;
  return key === GENERAL_CONVERSATION ? key : (postingConversation(key)?.postingId ?? null);
}

/** The conversations an agent is working (or starting) in, side by side. */
function busyConversations(state: PanelState | null): PanelState["agent"]["conversations"] {
  return (state?.agent.conversations ?? []).filter((c) => c.status === "working" || c.status === "starting");
}

/**
 * The applications for the list, newest first within each group, and the general conversation apart: one waiting on
 * a card needs the user, one an agent runs in is working, the rest are open until submitted or archived.
 */
export function applications(
  state: PanelState,
  agentName: string,
): { rows: ApplicationRow[]; general: ApplicationRow } {
  const busy = busyConversations(state);
  const partOf = (key?: string) => {
    const c = postingConversation(key ?? "");
    return c ? `${PARTS[c.part].label}: ` : "";
  };
  const doing = (key: string): Pick<ApplicationRow, "group" | "what"> | null => {
    const card = state.cards.find((c) => ownerOf(c.conversation) === key);
    if (card)
      return {
        group: "needs",
        what: partOf(card.conversation) + (card.kind === "ask" ? card.spec.title : `approve ${card.toolName}`),
      };
    const parts = busy.filter((c) => ownerOf(c.conversation) === key).map((c) => postingConversation(c.conversation));
    if (parts.length > 0) {
      const named = parts.flatMap((c) => (c ? [PARTS[c.part].label] : []));
      return { group: "working", what: `${named.length ? `${named.join(" and ")}: ` : ""}${agentName} is working` };
    }
    return null;
  };
  const rows = state.postings.map((p): ApplicationRow => {
    const now = doing(p.id);
    return {
      key: p.id,
      title: p.role ?? p.company ?? p.id,
      sub: [p.company, siteLabel(p.site)].filter(Boolean).join(" · "),
      what: now?.what ?? STANDING[p.status],
      group: now?.group ?? (p.status === "submitted" || p.status === "archived" ? "done" : "open"),
    };
  });
  const order = Object.keys(GROUPS) as Group[];
  rows.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  const now = doing(GENERAL_CONVERSATION);
  return {
    rows,
    general: {
      key: GENERAL_CONVERSATION,
      title: "General",
      sub: "",
      what: now?.what ?? "Anything not about one posting",
      group: now?.group ?? "open",
    },
  };
}

const DOTS: Record<Group, string> = {
  needs: "ez-dot-warn",
  working: "ez-dot-busy",
  open: "ez-dot-idle",
  done: "ez-dot-ok",
};

/** The list of applications, grouped; opening one shows its conversation, and a working one can be stopped here. */
function Applications({
  list,
  onOpen,
  onStop,
}: {
  list: { rows: ApplicationRow[]; general: ApplicationRow };
  onOpen: (key: string) => void;
  onStop: (key: string) => void;
}) {
  const row = (r: ApplicationRow) => (
    <li key={r.key} className="ez-app">
      <button type="button" className="ez-app-open" onClick={() => onOpen(r.key)}>
        <span className={`ez-dot ez-app-dot ${DOTS[r.group]}`} aria-hidden="true" />
        <span className="ez-app-text">
          <span className="ez-app-title">{r.title}</span>
          {r.sub ? <span className="ez-app-sub">{r.sub}</span> : null}
          <span className="ez-app-what">{r.what}</span>
        </span>
        <Icon name="chevronRight" size={15} />
      </button>
      {r.group === "working" ? <StopButton row={r} onStop={onStop} /> : null}
    </li>
  );
  const groups = (Object.keys(GROUPS) as Group[]).filter((g) => list.rows.some((r) => r.group === g));
  return (
    <nav className="ez-apps" aria-label="Applications">
      {list.rows.length === 0 ? (
        <p className="ez-muted">No applications yet. Open a job posting and press Capture.</p>
      ) : null}
      {groups.map((g) => (
        <section key={g} aria-label={GROUPS[g]}>
          <h2 className="ez-label">{GROUPS[g]}</h2>
          <ul>{list.rows.filter((r) => r.group === g).map(row)}</ul>
        </section>
      ))}
    </nav>
  );
}

function StopButton({ row, onStop }: { row: ApplicationRow; onStop: (key: string) => void }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className="ez-btn-icon"
      aria-label={`Stop ${row.title}`}
      title="Stop"
      onClick={() => onStop(row.key)}
    >
      <Icon name="stop" size={14} />
    </Button>
  );
}

/**
 * The general conversation, pinned above the list rather than one of its rows: it isn't an application, so it never
 * moves between the groups, and a pill says when it needs the user or the agent is in it.
 */
function GeneralCard({
  general,
  onOpen,
  onStop,
}: {
  general: ApplicationRow;
  onOpen: (key: string) => void;
  onStop: (key: string) => void;
}) {
  return (
    <div className={general.group === "needs" ? "ez-general-card ez-general-needs" : "ez-general-card"}>
      <button type="button" className="ez-general-open" onClick={() => onOpen(general.key)}>
        <span className="ez-general-icon" aria-hidden="true">
          <Icon name="comment" size={17} />
        </span>
        <span className="ez-app-text">
          <span className="ez-app-title">{general.title}</span>
          <span className="ez-app-what ez-general-what">{general.what}</span>
        </span>
        {general.group === "working" ? <span className="ez-pill ez-pill-busy">Working</span> : null}
        {general.group === "needs" ? <span className="ez-pill ez-pill-warn">Needs you</span> : null}
        <Icon name="chevronRight" size={15} />
      </button>
      {general.group === "working" ? <StopButton row={general} onStop={onStop} /> : null}
    </div>
  );
}

/** A conversation's events with a new one: a message's update replaces it (taken), anything else is added. */
export function withEvent(events: AgentEvent[], event: AgentEvent): AgentEvent[] {
  if (event.kind === "user") {
    const at = events.findIndex((e) => e.kind === "user" && e.id === event.id);
    if (at >= 0) return events.map((e, i) => (i === at ? event : e));
  }
  return [...events, event];
}

/** A posting's name, or a conversation's: the posting's with its part ("Acme: Developer · Application"). */
function labeller(postings: PanelPosting[]) {
  const byId = new Map(postings.map((p) => [p.id, p]));
  const name = (id: string) => {
    const p = byId.get(id);
    return p ? [p.company, p.role].filter(Boolean).join(": ") || p.id : id;
  };
  return (key: string) => {
    if (key === GENERAL_CONVERSATION) return "General";
    const c = postingConversation(key);
    return c ? `${name(c.postingId)} · ${PARTS[c.part].label}` : name(key);
  };
}

function siteLabel(site: string): string {
  return site === "generic" ? "" : site.charAt(0).toUpperCase() + site.slice(1);
}

function StatusDot({ conn }: { conn: ConnectionState }) {
  const [tone, text] =
    conn.state === "connected"
      ? ["ok", "Connected to ezapply"]
      : conn.state === "unconfigured"
        ? ["warn", "Not paired"]
        : conn.state === "error"
          ? ["danger", conn.message]
          : ["off", "ezapply isn't running"];
  return <span className={`ez-dot ez-dot-${tone}`} title={text} role="img" aria-label={text} />;
}

function Blocker({ conn }: { conn: ConnectionState }) {
  if (conn.state === "connected") return null;
  if (conn.state === "unconfigured") {
    return (
      <Banner tone="warn">
        The extension isn't paired with ezapply yet. Start ezapply, open Setup and follow the browser extension step.
      </Banner>
    );
  }
  if (conn.state === "error")
    return <Banner tone="danger">{[conn.message, conn.hint].filter(Boolean).join(" ")}</Banner>;
  return (
    <Banner tone="warn">
      ezapply isn't running. Start it in your workspace: <code>{"./ezapply"}</code> (on Windows{" "}
      <code>{".\\ezapply"}</code>
      ). The panel connects within a few seconds.
    </Banner>
  );
}

function TailorButton({ disabled, why, onPick }: { disabled: boolean; why?: string; onPick: (text: string) => void }) {
  return (
    <span className="ez-split" title={disabled ? why : undefined}>
      <Button disabled={disabled} onClick={() => onPick(REQUESTS.tailor)}>
        <Icon name="wand" size={16} /> Tailor documents
      </Button>
      <details className="ez-split-menu">
        <summary className={`ez-btn ez-btn-icon${disabled ? " ez-disabled" : ""}`} aria-label="More document requests">
          <Icon name="chevronDown" size={16} />
        </summary>
        {disabled ? null : (
          <div className="ez-panel-menu-items">
            <button type="button" onClick={() => onPick(REQUESTS.resume)}>
              Resume only
            </button>
            <button type="button" onClick={() => onPick(REQUESTS.cover)}>
              Cover letter only
            </button>
            <button type="button" onClick={() => onPick(REQUESTS.bundle)}>
              Put them in one PDF
            </button>
          </div>
        )}
      </details>
    </span>
  );
}

function FillButton({
  disabled,
  why,
  tab,
  application,
  onFill,
  onOpen,
}: {
  disabled: boolean;
  why?: string;
  tab: TabInfo;
  application?: string;
  onFill: (tabId: number) => void;
  onOpen: (url: string) => void;
}) {
  const onApplication = tab && (tab.kind === "application" || tab.kind === "unconfirmed-application");
  if (!onApplication && application) {
    return (
      <Button
        disabled={disabled}
        title={disabled ? why : "Open the application in a new tab"}
        onClick={() => onOpen(application)}
      >
        <Icon name="form" size={16} /> Open the application
      </Button>
    );
  }
  const reason = disabled ? why : onApplication ? undefined : "Open the application's page in this tab first";
  return (
    <Button disabled={disabled || !onApplication} title={reason} onClick={() => tab && onFill(tab.tabId)}>
      <Icon name="form" size={16} /> Fill form
    </Button>
  );
}

/** Approved (an attached document was approved first), or not yet: the one thing the user acts on. */
function isApproved(state: PanelConversation["documents"][number]["state"]): boolean {
  return state === "approved" || state === "attached";
}

function DocState({ state }: { state: PanelConversation["documents"][number]["state"] }) {
  return isApproved(state) ? <Badge tone="ok">approved</Badge> : <Badge tone="warn">waiting for your review</Badge>;
}

function CardView({
  card,
  label,
  transport,
  fail,
}: {
  card: Card;
  label?: string;
  transport: PanelTransport;
  fail: (err: unknown) => void;
}) {
  if (card.kind === "ask") {
    return (
      <AskCardView
        card={card}
        {...(label ? { label } : {})}
        onAnswer={async (answers) => {
          await transport.call("panel.answer", { cardId: card.id, answers });
        }}
        onReply={async (message) => {
          await transport.call("panel.reply", { cardId: card.id, message });
        }}
      />
    );
  }
  return (
    <PermissionCardView
      card={card}
      {...(label ? { label } : {})}
      onDecide={async (allow, reason) => {
        await transport
          .call("panel.permission", { cardId: card.id, allow, ...(reason?.trim() ? { reason: reason.trim() } : {}) })
          .catch((err) => {
            fail(err);
            throw err;
          });
      }}
    />
  );
}

/** The conversation: messages, Claude's text, tool calls folded to a line, settled cards, each turn's end. */
export function Conversation({ events, agent = AGENTS.claude }: { events: AgentEvent[]; agent?: string }) {
  const end = useRef<HTMLDivElement>(null);
  const done = useMemo(() => {
    const m = new Map<string, Extract<AgentEvent, { kind: "toolDone" }>>();
    for (const e of events) if (e.kind === "toolDone") m.set(e.id, e);
    return m;
  }, [events]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every new event
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [events.length]);
  if (events.length === 0) {
    return <p className="ez-panel-empty">Nothing here yet. Use the buttons below, or ask anything.</p>;
  }
  // Each turn's cost: the session's total so far, less the turn before's.
  const costs = new Map<number, number>();
  let lastCost: number | undefined;
  events.forEach((e, n) => {
    if (e.kind !== "turnEnd" || e.totalCostUsd === undefined) return;
    costs.set(n, lastCost !== undefined ? e.totalCostUsd - lastCost : e.totalCostUsd);
    lastCost = e.totalCostUsd;
  });
  return (
    <section className="ez-convo" aria-label="Conversation" aria-live="polite">
      {events.map((e, n) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the conversation only grows at its end and never reorders
        <EventView key={n} event={e} done={done} cost={costs.get(n)} agent={agent} />
      ))}
      <div ref={end} />
    </section>
  );
}

function EventView({
  event: e,
  done,
  cost,
  agent,
}: {
  event: AgentEvent;
  done: Map<string, Extract<AgentEvent, { kind: "toolDone" }>>;
  cost?: number;
  /** The agent's name, for a message it hasn't taken yet. */
  agent: string;
}) {
  switch (e.kind) {
    case "user":
      // A result ezapply sent for the user (a card's answers, a review): a note, not their own words.
      if (e.delivery) {
        return (
          <p className="ez-msg-note">
            {e.taken === false ? `${e.text}: waiting for ${agent}` : `${e.text}: sent to ${agent}`}
          </p>
        );
      }
      return (
        <div className="ez-msg-user">
          {e.text}
          {e.taken === false ? <span className="ez-msg-queued">waiting for {agent}</span> : null}
        </div>
      );
    case "text":
      return (
        <div className={e.parent ? "ez-msg-claude ez-msg-sub" : "ez-msg-claude"}>
          <Markdown text={e.text} />
        </div>
      );
    case "tool": {
      const d = done.get(e.id);
      const name = e.name.replace(/^mcp__ezapply__/, "");
      return (
        <details className={`ez-tool${d && !d.ok ? " ez-tool-failed" : ""}${e.parent ? " ez-msg-sub" : ""}`}>
          <summary>
            <span className="ez-tool-name">{name}</span> {e.summary}
            {d ? null : <span className="ez-tool-running"> …</span>}
          </summary>
          {d?.error ? <pre>{d.error}</pre> : <pre>{e.summary || "(no arguments)"}</pre>}
        </details>
      );
    }
    case "card":
      return (
        <p className="ez-msg-note">
          {e.title}: {e.outcome}
        </p>
      );
    case "turnEnd": {
      const what = e.interrupted ? "Stopped" : e.ok ? "Done" : `Failed: ${e.error ?? "unknown error"}`;
      return (
        <p className={e.ok || e.interrupted ? "ez-msg-note" : "ez-msg-note ez-msg-error"}>
          {what}
          {cost !== undefined ? ` · $${cost.toFixed(2)}` : ""}
        </p>
      );
    }
    case "notice":
      return <p className={`ez-msg-notice ez-msg-notice-${e.level}`}>{e.text}</p>;
    default:
      return null;
  }
}

/** What the agent is doing, named as the one in use (`name`). */
function AgentLine({
  state,
  name,
  selected,
  labelOf,
}: {
  state: PanelState | null;
  name: string;
  selected: string;
  labelOf: (id: string) => string;
}) {
  const agent = state?.agent;
  if (!agent) return null;
  let text = "";
  const here = agent.conversations.find((c) => c.conversation === selected);
  const others = busyConversations(state).filter((c) => c.conversation !== selected);
  if (agent.status === "unavailable")
    text = `No agent is available: neither ${AGENTS.claude} nor ${AGENTS.antigravity} was found when ezapply started.`;
  else if (here?.status === "starting") text = `Starting ${name}…`;
  else if (here?.status === "working") text = `${name} is working…`;
  if (here && here.queued > 0) text += ` ${here.queued} waiting.`;
  // The others go on at the same time; one is named, more are counted.
  const also = text ? "Also" : `${name} is`;
  if (others.length === 1) text += ` ${also} working on ${labelOf(others[0]?.conversation ?? "")}…`;
  else if (others.length > 1) text += ` ${also} working on ${others.length} others…`;
  return text ? (
    <p className="ez-panel-agent" role="status">
      {text.trim()}
    </p>
  ) : null;
}

/**
 * The agent, and its own permission mode, model and effort: kept by the extension, and applied by ezapply to the
 * running conversation (Claude Code's mode and model at once, the rest from its next message). The agent is offered
 * only when more than one is installed. Antigravity has two modes (headless, it runs what its rules allow, or plans)
 * and the models `agy models` lists, or its own default; no effort, since its models name their level.
 */
function AgentSettingsBar({
  settings,
  agents,
  antigravityModels,
  disabled,
  onChange,
}: {
  settings: AgentSettings;
  agents: AgentKind[];
  antigravityModels?: { id: string; label: string }[];
  disabled: boolean;
  onChange: (change: Partial<AgentSettings>) => void;
}) {
  const claude = settings.agent === "claude";
  const modes = claude ? MODES : ANTIGRAVITY_MODES;
  // The chosen model shows before the list is in (or once it's no longer listed), by its id.
  const listed = antigravityModels ?? [];
  const antigravity =
    settings.model && !claude && !listed.some((m) => m.id === settings.model)
      ? [...listed, { id: settings.model, label: settings.model }]
      : listed;
  // Antigravity runs anything but Plan only as Don't ask.
  const mode = claude || settings.permissionMode === "plan" ? settings.permissionMode : "dontAsk";
  return (
    <>
      {agents.length > 1 ? (
        <select
          className="ez-select ez-select-sm ez-select-gives"
          aria-label="Agent"
          title="The coding agent. Changing it starts a new conversation from the next message."
          value={settings.agent}
          disabled={disabled}
          onChange={(e) => onChange({ agent: AgentKind.parse(e.target.value) })}
        >
          {agents.map((a) => (
            <option key={a} value={a}>
              {AGENTS[a]}
            </option>
          ))}
        </select>
      ) : null}
      <select
        className="ez-select ez-select-sm"
        aria-label="Permission mode"
        title={modes[mode]?.what}
        value={mode}
        disabled={disabled}
        onChange={(e) => onChange({ permissionMode: AgentPermissionMode.parse(e.target.value) })}
      >
        {AgentPermissionMode.options.map((m) => {
          const label = modes[m];
          return label ? (
            <option key={m} value={m} title={label.what}>
              {label.label}
            </option>
          ) : null;
        })}
      </select>
      {claude ? (
        <select
          className="ez-select ez-select-sm"
          aria-label="Model"
          value={settings.model}
          disabled={disabled}
          onChange={(e) => onChange({ model: AgentModel.parse(e.target.value) })}
        >
          {AgentModel.options.map((m) => (
            <option key={m} value={m}>
              {MODELS[m]}
            </option>
          ))}
        </select>
      ) : (
        <select
          className="ez-select ez-select-sm ez-select-gives"
          aria-label="Model"
          title="Antigravity's model. Applies from the next message."
          value={settings.model ?? ""}
          disabled={disabled}
          onChange={(e) => onChange({ model: e.target.value || undefined })}
        >
          <option value="">Default model</option>
          {antigravity.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      )}
      {/* Antigravity's models carry their own level ("Gemini 3.8 Flash (High)"), so it has no effort to choose. */}
      {claude ? (
        <select
          className="ez-select ez-select-sm ez-select-gives"
          aria-label="Effort"
          title="How hard the agent thinks: more effort is slower and costs more. Applies from the next message."
          value={settings.effort}
          disabled={disabled}
          onChange={(e) => onChange({ effort: AgentEffort.parse(e.target.value) })}
        >
          {AgentEffort.options.map((m) => (
            <option key={m} value={m}>
              {EFFORTS[m]}
            </option>
          ))}
        </select>
      ) : null}
    </>
  );
}

function ChatBar({
  disabled,
  working,
  sending,
  onSend,
  onStop,
}: {
  disabled: boolean;
  working: boolean;
  /** A message is on its way: the box is read-only (it keeps its focus) and Send is disabled. */
  sending: boolean;
  onSend: (text: string) => Promise<void>;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    try {
      await onSend(t);
      setText("");
    } catch {
      // the panel shows the error; the text stays
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };
  return (
    <div className="ez-chatbar">
      <textarea
        className="ez-textarea"
        rows={2}
        value={text}
        disabled={disabled}
        readOnly={sending}
        placeholder="Ask or tell ezapply anything"
        aria-label="Message"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
      />
      {working && !text.trim() ? (
        <Button onClick={onStop} aria-label="Stop">
          <Icon name="stop" size={16} /> Stop
        </Button>
      ) : (
        <Button
          variant="primary"
          disabled={disabled || sending || !text.trim()}
          onClick={() => void submit()}
          aria-label="Send"
        >
          <Icon name="send" size={16} />
        </Button>
      )}
    </div>
  );
}

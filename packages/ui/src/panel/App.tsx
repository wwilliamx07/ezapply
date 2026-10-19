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
export const MODES: Record<AgentPermissionMode, { label: string; what: string }> = {
  default: {
    label: "Ask first",
    what: "Claude asks on the panel before commands and edits the workspace doesn't allow",
  },
  acceptEdits: { label: "Accept edits", what: "File edits go ahead without asking; commands still ask" },
  auto: { label: "Auto", what: "Claude Code decides what's safe to run without asking, and asks for the rest" },
  plan: { label: "Plan only", what: "Claude reads and plans, and changes nothing" },
  dontAsk: { label: "Don't ask", what: "Only what the workspace allows runs; anything else is denied without asking" },
};
/** Antigravity's modes: headless, nobody can approve a call, so it runs what its rules allow, or only plans. */
export const ANTIGRAVITY_MODES: Partial<Record<AgentPermissionMode, { label: string; what: string }>> = {
  dontAsk: {
    label: "Don't ask",
    what: "Only what your Antigravity rules allow runs; anything else is denied and ends the turn",
  },
  plan: { label: "Plan only", what: "Antigravity reads and plans, and changes nothing" },
};
export const AGENTS: Record<AgentKind, string> = { claude: "Claude Code", antigravity: "Antigravity" };
export const MODELS: Record<AgentModel, string> = {
  fable: "Fable",
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};
export const EFFORTS: Record<AgentEffort, string> = {
  low: "Low effort",
  medium: "Medium effort",
  high: "High effort",
  xhigh: "Extra high effort",
  max: "Max effort",
};

/** A posting's two conversations, as the panel's switch names them. */
export const PARTS: Record<ConversationPart, { label: string; what: string }> = {
  tailor: { label: "Documents", what: "The conversation that tailors this posting's documents" },
  fill: { label: "Application", what: "The conversation that fills this posting's application" },
};

/**
 * The extension's side panel: everything the user does with ezapply after setup ("Everything in the browser"). It
 * shows one of the active posting's conversations with the agent (its documents' or its application's), its
 * documents and what the current tab is, the cards waiting on the user, and a chat bar; the buttons send the same
 * requests typing would, each to its own conversation.
 */
export function PanelApp({ transport }: { transport: PanelTransport }) {
  const [conn, setConn] = useState<ConnectionState>({ state: "connecting" });
  const [state, setState] = useState<PanelState | null>(null);
  /** The posting picked in the panel (or the general conversation); null follows the active posting. */
  const [picked, setPicked] = useState<string | null>(null);
  /** The posting's conversation picked in the panel; null shows the one Claude works in, else its documents'. */
  const [part, setPart] = useState<ConversationPart | null>(null);
  const [conv, setConv] = useState<PanelConversation | null>(null);
  const [tab, setTab] = useState<TabInfo>(null);
  const [error, setError] = useState<string | null>(null);
  const postingId = picked ?? state?.activePostingId ?? GENERAL_CONVERSATION;
  const running = postingConversation(state?.agent.conversation ?? "");
  const shownPart = part ?? (running?.postingId === postingId ? running.part : "tailor");
  const selected = postingId === GENERAL_CONVERSATION ? postingId : conversationKey(postingId, shownPart);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

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
    setTab(await transport.tab().catch(() => null));
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

  // A different conversation picked, or the active posting changed under a followed one.
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
  const working = agent?.status === "working" || agent?.status === "starting";
  const workingHere = working && agent?.conversation === selected;
  const workingElsewhere = working && agent?.conversation !== selected;
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
      else setPicked(null);
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
    if (key !== GENERAL_CONVERSATION) void transport.call("panel.activate", { postingId: key }).catch(fail);
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
      await refreshState();
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

  const busyWhy = sending
    ? "Sending…"
    : workingHere
      ? `${agentName} is working: wait, or Stop it`
      : workingElsewhere
        ? `${agentName} is working in another conversation`
        : undefined;
  const cards = state?.cards ?? [];
  const docCount = conv?.documents.length ?? 0;
  const waiting = conv?.documents.filter((d) => !isApproved(d.state)).length ?? 0;

  return (
    <div className="ez-panel">
      <header className="ez-panel-head">
        <Brand />
        <StatusDot conn={conn} />
        <select
          className="ez-select ez-panel-picker"
          aria-label="Posting"
          value={postingId}
          disabled={!connected}
          onChange={(e) => pick(e.target.value)}
        >
          {(state?.postings ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {labelOf(p.id)}
            </option>
          ))}
          <option value={GENERAL_CONVERSATION}>No posting (general)</option>
        </select>
        {/* Beside the picker: it adds a posting to choose from, where the footer acts on the chosen one. */}
        <Button
          size="sm"
          className="ez-panel-capture"
          disabled={!connected}
          onClick={capture}
          title={
            tab?.kind === "posting"
              ? "Capture this posting's page again"
              : "Capture the page in this tab as a posting, and make it the active one"
          }
        >
          <Icon name="plus" size={14} /> Capture
        </Button>
        <details className="ez-panel-menu ez-panel-details">
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
            ) : (
              <section className="ez-panel-posting" aria-label="Conversation">
                <div className="ez-panel-role">General</div>
                <div className="ez-muted">No posting. Capture one from its page, or ask anything.</div>
              </section>
            )}
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
            {posting || general ? (
              <div className="ez-panel-pop-actions">
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
                {posting ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!connected || working}
                    className="ez-panel-danger"
                    onClick={() => void deletePosting()}
                    title={
                      working
                        ? `${agentName} is working: wait, or Stop it`
                        : "Delete this posting and everything in its folder"
                    }
                  >
                    Delete posting
                  </Button>
                ) : null}
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

      {posting ? (
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
              {working && agent?.conversation === conversationKey(postingId, p) ? (
                <span className="ez-dot ez-dot-ok" role="img" aria-label={`${agentName} is working here`} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* Only the conversation scrolls: the buttons and the chat box stay put below it, however long it gets. */}
      <div className={connected ? "ez-panel-body" : "ez-panel-body ez-panel-off"} aria-disabled={!connected}>
        <Conversation events={conv?.events ?? []} agent={agentName} />
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
        {tab ? (
          <p className={`ez-panel-tab ez-panel-tab-${tab.kind}`}>
            <Icon name={tab.kind === "application" || tab.kind === "posting" ? "check" : "info"} size={15} /> This tab:{" "}
            {tab.text}
          </p>
        ) : null}
        <div className={connected ? "ez-panel-actions" : "ez-panel-actions ez-panel-off"}>
          <TailorButton
            disabled={!connected || !posting || working || sending}
            why={!posting ? "Capture a posting first" : busyWhy}
            onPick={(text) => request("tailor", text)}
          />
          <FillButton
            disabled={!connected || !posting || working || sending}
            why={!posting ? "Capture a posting first" : busyWhy}
            tab={tab}
            application={posting?.application}
            onFill={(tabId) => request("fill", REQUESTS.fill(tabId))}
            onOpen={(url) => void transport.openTab(url).catch(fail)}
          />
        </div>
        <AgentLine state={state} name={agentName} selected={selected} labelOf={labelOf} />
        <ChatBar
          disabled={!connected || agent?.status === "unavailable"}
          working={workingHere}
          sending={sending}
          onSend={send}
          onStop={() => void transport.call("panel.stop", {}).catch(fail)}
        />
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
          {conv?.totalCostUsd !== undefined ? (
            <p className="ez-panel-cost" title="What this conversation has cost so far">
              ${conv.totalCostUsd.toFixed(2)}
            </p>
          ) : null}
        </div>
      </footer>
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
export function isApproved(state: PanelConversation["documents"][number]["state"]): boolean {
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
  if (agent.status === "unavailable")
    text = `No agent is available: neither ${AGENTS.claude} nor ${AGENTS.antigravity} was found when ezapply started.`;
  else if (agent.status === "starting") text = `Starting ${name}…`;
  else if (agent.status === "working") {
    text =
      agent.conversation === selected
        ? `${name} is working…`
        : `${name} is working on ${labelOf(agent.conversation ?? "")}…`;
  }
  if (agent.queued > 0 && agent.conversation === selected) text += ` ${agent.queued} waiting.`;
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

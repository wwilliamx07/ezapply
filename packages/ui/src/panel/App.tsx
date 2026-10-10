import {
  type AgentEvent,
  AgentModel,
  AgentPermissionMode,
  type AgentSettings,
  type Card,
  GENERAL_CONVERSATION,
  type PanelConversation,
  type PanelPosting,
  type PanelState,
  type PanelTab,
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
export const MODELS: Record<AgentModel, string> = {
  default: "Default model",
  fable: "Fable",
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
};

/**
 * The extension's side panel: everything the user does with ezapply after setup ("Everything in the browser"). It
 * shows the active posting's conversation with the agent, its documents and what the current tab is, the cards
 * waiting on the user, and a chat bar; the buttons send the same requests typing would.
 */
export function PanelApp({ transport }: { transport: PanelTransport }) {
  const [conn, setConn] = useState<ConnectionState>({ state: "connecting" });
  const [state, setState] = useState<PanelState | null>(null);
  /** The conversation picked in the panel; null follows the active posting. */
  const [picked, setPicked] = useState<string | null>(null);
  const [conv, setConv] = useState<PanelConversation | null>(null);
  const [tab, setTab] = useState<TabInfo>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = picked ?? state?.activePostingId ?? GENERAL_CONVERSATION;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  const fail = useCallback((err: unknown) => setError((err as Error).message ?? String(err)), []);
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
  const working = agent?.status === "working" || agent?.status === "starting";
  const workingHere = working && agent?.conversation === selected;
  const workingElsewhere = working && agent?.conversation !== selected;
  const posting = conv?.posting;
  const labelOf = useMemo(() => labeller(state?.postings ?? []), [state?.postings]);

  const send = async (text: string) => {
    setError(null);
    try {
      await transport.call("panel.send", { key: selected, text });
    } catch (err) {
      fail(err);
      throw err;
    }
  };
  const capture = () => {
    setError(null);
    // Called inside the click: Firefox asks for access to websites only during the gesture.
    void transport.capture().then((r) => {
      if (!r.ok) setError(r.error);
      else setPicked(null);
    });
  };
  const pick = (key: string) => {
    setPicked(key);
    if (key !== GENERAL_CONVERSATION) void transport.call("panel.activate", { postingId: key }).catch(fail);
  };
  const reset = async () => {
    if (!window.confirm("Start a new conversation for this posting? Claude forgets this one; the documents stay."))
      return;
    await transport.call("panel.reset", { key: selected }).catch(fail);
    await refreshConv().catch(fail);
  };

  // A new card brings the "Needs you" cards into view (the conversation doesn't scroll past them meanwhile).
  const needsRef = useRef<HTMLElement>(null);
  const cardIds = (state?.cards ?? []).map((c) => c.id).join(",");
  useEffect(() => {
    if (cardIds) needsRef.current?.scrollIntoView?.({ block: "start" });
  }, [cardIds]);

  const busyWhy = workingHere
    ? "Claude is working: wait, or Stop it"
    : workingElsewhere
      ? "Claude is working in another conversation"
      : undefined;
  const cards = state?.cards ?? [];

  return (
    <div className="ez-panel">
      <header className="ez-panel-head">
        <Brand />
        <StatusDot conn={conn} />
        <select
          className="ez-select ez-panel-picker"
          aria-label="Posting"
          value={selected}
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

      <div className={connected ? "ez-panel-body" : "ez-panel-body ez-panel-off"} aria-disabled={!connected}>
        {posting ? (
          <section className="ez-panel-posting" aria-label="Posting">
            <div className="ez-panel-posting-top">
              <div>
                <div className="ez-panel-role">{posting.role ?? posting.id}</div>
                <div className="ez-muted">
                  {[posting.company, siteLabel(posting.site), posting.deadline ? `due ${posting.deadline}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={!connected}
                className="ez-panel-reset"
                onClick={reset}
                title="A new conversation for this posting"
              >
                Reset Conversation
              </Button>
            </div>
            <div className="ez-chips">
              <Badge tone="accent">{posting.status}</Badge>
              {posting.requirements.map((r) => (
                <span key={r} className="ez-chip">
                  {r}
                </span>
              ))}
            </div>
          </section>
        ) : (
          <section className="ez-panel-posting" aria-label="Conversation">
            <div className="ez-panel-role">General</div>
            <div className="ez-muted">No posting. Set one from its page, or ask anything.</div>
          </section>
        )}

        {tab ? (
          <p className={`ez-panel-tab ez-panel-tab-${tab.kind}`}>
            <Icon name={tab.kind === "application" || tab.kind === "posting" ? "check" : "info"} size={15} /> This tab:{" "}
            {tab.text}
          </p>
        ) : null}

        <div className="ez-panel-actions">
          <Button disabled={!connected} onClick={capture} title="Make the page in this tab the posting">
            <Icon name="target" size={16} /> {tab?.kind === "posting" ? "Capture again" : "Set posting"}
          </Button>
          <TailorButton
            disabled={!connected || !posting || working}
            why={!posting ? "Set a posting first" : busyWhy}
            onPick={(text) => void send(text).catch(() => {})}
          />
          <FillButton
            disabled={!connected || !posting || working}
            why={!posting ? "Set a posting first" : busyWhy}
            tab={tab}
            application={posting?.application}
            onFill={(tabId) => void send(REQUESTS.fill(tabId)).catch(() => {})}
            onOpen={(url) => void transport.openTab(url).catch(fail)}
          />
        </div>

        {conv && conv.documents.length > 0 ? (
          <section className="ez-panel-docs" aria-label="Documents">
            <p className="ez-label">Documents</p>
            {conv.documents.map((d) => (
              <div key={d.file} className="ez-panel-doc">
                <button
                  type="button"
                  className="ez-linklike"
                  onClick={() =>
                    void transport.call("panel.open", { what: "file", postingId: selected, file: d.file }).catch(fail)
                  }
                >
                  <Icon name="file" size={15} /> {d.file}
                </button>
                <DocState state={d.state} />
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
        ) : null}

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

        <Conversation events={conv?.events ?? []} follow={cards.length === 0} />
      </div>

      <footer className="ez-panel-foot">
        <AgentLine state={state} selected={selected} labelOf={labelOf} />
        <ChatBar
          disabled={!connected || agent?.status === "unavailable"}
          working={workingHere}
          onSend={send}
          onStop={() => void transport.call("panel.stop", {}).catch(fail)}
        />
        <div className="ez-panel-settings">
          {agent?.settings ? (
            <AgentSettingsBar
              settings={agent.settings}
              disabled={!connected || agent.status === "unavailable"}
              onChange={(change) =>
                void transport
                  .call("panel.settings", change)
                  .then(() => refreshState())
                  .catch(fail)
              }
            />
          ) : null}
          {conv?.totalCostUsd !== undefined ? (
            <p className="ez-panel-cost">This conversation: ${conv.totalCostUsd.toFixed(2)}</p>
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

function labeller(postings: PanelPosting[]) {
  const byId = new Map(postings.map((p) => [p.id, p]));
  return (id: string) => {
    if (id === GENERAL_CONVERSATION) return "General";
    const p = byId.get(id);
    return p ? [p.company, p.role].filter(Boolean).join(": ") || p.id : id;
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
      ). The panel connects within half a minute.
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

function DocState({ state }: { state: PanelConversation["documents"][number]["state"] }) {
  const [tone, text] =
    state === "approved"
      ? (["ok", "approved"] as const)
      : state === "attached"
        ? (["ok", "attached"] as const)
        : state === "review"
          ? (["warn", "waiting for your review"] as const)
          : state === "changes"
            ? (["danger", "changes asked"] as const)
            : ([undefined, "draft"] as const);
  return <Badge tone={tone}>{text}</Badge>;
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
export function Conversation({ events, follow = true }: { events: AgentEvent[]; follow?: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  const done = useMemo(() => {
    const m = new Map<string, Extract<AgentEvent, { kind: "toolDone" }>>();
    for (const e of events) if (e.kind === "toolDone") m.set(e.id, e);
    return m;
  }, [events]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every new event
  useEffect(() => {
    if (follow) end.current?.scrollIntoView?.({ block: "end" });
  }, [events.length]);
  if (events.length === 0) {
    return <p className="ez-panel-empty">Nothing here yet. Use the buttons above, or ask anything below.</p>;
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
        <EventView key={n} event={e} done={done} cost={costs.get(n)} />
      ))}
      <div ref={end} />
    </section>
  );
}

function EventView({
  event: e,
  done,
  cost,
}: {
  event: AgentEvent;
  done: Map<string, Extract<AgentEvent, { kind: "toolDone" }>>;
  cost?: number;
}) {
  switch (e.kind) {
    case "user":
      return (
        <div className="ez-msg-user">
          {e.text}
          {e.taken === false ? <span className="ez-msg-queued">waiting for Claude</span> : null}
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

function AgentLine({
  state,
  selected,
  labelOf,
}: {
  state: PanelState | null;
  selected: string;
  labelOf: (id: string) => string;
}) {
  const agent = state?.agent;
  if (!agent) return null;
  let text = "";
  if (agent.status === "unavailable")
    text = "Claude runs here when ezapply is started with `ezapply`, not `ezapply chat`.";
  else if (agent.status === "starting") text = "Starting Claude…";
  else if (agent.status === "working") {
    text =
      agent.conversation === selected
        ? "Claude is working…"
        : `Claude is working on ${labelOf(agent.conversation ?? "")}…`;
  }
  if (agent.queued > 0 && agent.conversation === selected) text += ` ${agent.queued} waiting.`;
  return text ? (
    <p className="ez-panel-agent" role="status">
      {text.trim()}
    </p>
  ) : null;
}

/** The permission mode and model, kept by ezapply and applied to the running conversation at once. */
function AgentSettingsBar({
  settings,
  disabled,
  onChange,
}: {
  settings: AgentSettings;
  disabled: boolean;
  onChange: (change: Partial<AgentSettings>) => void;
}) {
  return (
    <>
      <select
        className="ez-select ez-select-sm"
        aria-label="Permission mode"
        title={MODES[settings.permissionMode].what}
        value={settings.permissionMode}
        disabled={disabled}
        onChange={(e) => onChange({ permissionMode: AgentPermissionMode.parse(e.target.value) })}
      >
        {AgentPermissionMode.options.map((m) => (
          <option key={m} value={m} title={MODES[m].what}>
            {MODES[m].label}
          </option>
        ))}
      </select>
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
    </>
  );
}

function ChatBar({
  disabled,
  working,
  onSend,
  onStop,
}: {
  disabled: boolean;
  working: boolean;
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
        <Button variant="primary" disabled={disabled || !text.trim()} onClick={() => void submit()} aria-label="Send">
          <Icon name="send" size={16} />
        </Button>
      )}
    </div>
  );
}

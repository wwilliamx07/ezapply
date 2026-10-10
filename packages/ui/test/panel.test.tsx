// @vitest-environment jsdom
import type { AgentEvent, AskQuestion, Card, PanelConversation, PanelState } from "@ezapply/protocol";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Conversation, PanelApp, REQUESTS, withEvent } from "../src/panel/App.js";
import { answerOf, initialDraft, permissionBody } from "../src/panel/cards.js";
import { Markdown } from "../src/panel/markdown.js";
import type { ConnectionState, PanelPush, PanelTransport } from "../src/panel/transport.js";

afterEach(cleanup);

const AT = "2026-01-01T00:00:00.000Z";
const POSTING = {
  id: "2026-01-01_acme_dev",
  company: "Acme",
  role: "Software Developer",
  site: "workday" as const,
  status: "drafting" as const,
  url: "https://example-tenant.myworkdayjobs.com/en-US/careers/job/REQ-0000",
  active: true,
};

function state(over: Partial<PanelState> = {}): PanelState {
  return {
    agent: { status: "idle", queued: 0, settings: { permissionMode: "auto", model: "sonnet", effort: "medium" } },
    activePostingId: POSTING.id,
    postings: [POSTING],
    cards: [],
    setup: { ready: true, left: [] },
    ...over,
  };
}
function conversation(over: Partial<PanelConversation> = {}): PanelConversation {
  return {
    key: POSTING.id,
    posting: { ...POSTING, requirements: ["One PDF", "Cover letter required"], application: POSTING.url },
    documents: [{ file: "resume.pdf", state: "approved" }],
    events: [],
    ...over,
  };
}

/** A transport that answers from the given state, records calls, and lets a test push. */
function fakeTransport(opts: {
  conn?: ConnectionState;
  state?: PanelState;
  conv?: PanelConversation;
  tab?: Awaited<ReturnType<PanelTransport["tab"]>>;
}) {
  const listeners = new Set<(p: PanelPush) => void>();
  const calls: [string, unknown][] = [];
  let st = opts.state ?? state();
  let cv = opts.conv ?? conversation();
  const transport: PanelTransport = {
    call: vi.fn(async (method: string, params: unknown) => {
      calls.push([method, params]);
      if (method === "panel.state") return st;
      if (method === "panel.conversation") return cv;
      if (method === "panel.send") return { id: "m1" };
      if (method === "panel.stop") return { stopped: true };
      return {};
    }) as PanelTransport["call"],
    capture: vi.fn(async () => ({ ok: true as const, postingId: POSTING.id, label: "Acme: Software Developer" })),
    tab: vi.fn(async () => opts.tab ?? null),
    openTab: vi.fn(async () => {}),
    openSettings: vi.fn(async () => {}),
    connection: vi.fn(async () => opts.conn ?? { state: "connected" as const }),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return {
    transport,
    calls,
    push: (p: PanelPush) =>
      act(() => {
        for (const fn of listeners) fn(p);
      }),
    setState: (s: PanelState) => {
      st = s;
    },
    setConv: (c: PanelConversation) => {
      cv = c;
    },
  };
}

describe("the side panel", () => {
  it("shows the active posting with its requirements, documents and what this tab is, and the buttons send requests", async () => {
    const t = fakeTransport({
      tab: { kind: "application", text: "Acme: Software Developer: the application on Workday", tabId: 7 },
    });
    render(<PanelApp transport={t.transport} />);
    expect(await screen.findByText("Software Developer")).toBeTruthy();
    expect(screen.getByText("One PDF")).toBeTruthy();
    expect(screen.getByText("resume.pdf")).toBeTruthy();
    expect(screen.getByText("approved")).toBeTruthy();
    expect(await screen.findByText(/the application on Workday/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Tailor documents/ }));
    fireEvent.click(screen.getByRole("button", { name: /Fill form/ }));
    await waitFor(() => expect(t.calls.filter(([m]) => m === "panel.send")).toHaveLength(2));
    expect(t.calls.filter(([m]) => m === "panel.send").map(([, p]) => p)).toEqual([
      { key: POSTING.id, text: REQUESTS.tailor },
      { key: POSTING.id, text: REQUESTS.fill(7) },
    ]);
  });

  it("opens the application when this tab isn't it, captures on Set posting, and resets after asking", async () => {
    const t = fakeTransport({ tab: { kind: "page", text: "Not this posting's application", tabId: 3 } });
    render(<PanelApp transport={t.transport} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open the application/ }, { timeout: 5000 }));
    expect(t.transport.openTab).toHaveBeenCalledWith(POSTING.url);
    fireEvent.click(screen.getByRole("button", { name: /Set posting/ }));
    expect(t.transport.capture).toHaveBeenCalledTimes(1);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset Conversation" }));
    await waitFor(() => expect(t.calls).toContainEqual(["panel.reset", { key: POSTING.id }]), { timeout: 5000 });
    confirm.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Extension settings" }));
    expect(t.transport.openSettings).toHaveBeenCalledTimes(1);
  });

  it("shows the permission mode, model and effort, and changes them through ezapply", async () => {
    const t = fakeTransport({});
    render(<PanelApp transport={t.transport} />);
    const mode = (await screen.findByRole("combobox", { name: "Permission mode" })) as HTMLSelectElement;
    const model = screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement;
    const effort = screen.getByRole("combobox", { name: "Effort" }) as HTMLSelectElement;
    expect([mode.value, model.value, effort.value]).toEqual(["auto", "sonnet", "medium"]);
    expect([...mode.options].map((o) => o.value)).not.toContain("bypassPermissions");
    t.setState(
      state({
        agent: { ...state().agent, settings: { permissionMode: "default", model: "sonnet", effort: "medium" } },
      }),
    );
    fireEvent.change(mode, { target: { value: "default" } });
    await waitFor(() => expect(t.calls).toContainEqual(["panel.settings", { permissionMode: "default" }]));
    await waitFor(() => expect(mode.value).toBe("default"));
    fireEvent.change(model, { target: { value: "opus" } });
    await waitFor(() => expect(t.calls).toContainEqual(["panel.settings", { model: "opus" }]));
    fireEvent.change(effort, { target: { value: "max" } });
    await waitFor(() => expect(t.calls).toContainEqual(["panel.settings", { effort: "max" }]));
  });

  it("says when ezapply isn't running or the extension isn't paired, and disables the rest", async () => {
    const off = fakeTransport({ conn: { state: "disconnected", reason: "refused" } });
    const { unmount } = render(<PanelApp transport={off.transport} />);
    expect(await screen.findByText(/ezapply isn't running/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Set posting/ }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    render(<PanelApp transport={fakeTransport({ conn: { state: "unconfigured" } }).transport} />);
    expect(await screen.findByText(/isn't paired/)).toBeTruthy();
  });

  it("shows setup that isn't finished, with a way back to it", async () => {
    const t = fakeTransport({ state: state({ setup: { ready: false, left: ["tex", "profile"] } }) });
    render(<PanelApp transport={t.transport} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue setup" }));
    expect(t.calls).toContainEqual(["panel.open", { what: "setup" }]);
  });

  it("adds pushed events to the conversation, and turns Send into Stop while Claude works", async () => {
    const t = fakeTransport({});
    render(<PanelApp transport={t.transport} />);
    await screen.findByText("Software Developer");
    const box = screen.getByLabelText("Message");
    fireEvent.change(box, { target: { value: "make it shorter" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(t.calls).toContainEqual(["panel.send", { key: POSTING.id, text: "make it shorter" }]));

    t.push({
      type: "update",
      update: {
        event: {
          conversation: POSTING.id,
          event: { kind: "user", at: AT, id: "m1", text: "make it shorter", taken: false },
        },
      },
    });
    expect(await screen.findByText("waiting for Claude")).toBeTruthy();
    t.push({
      type: "update",
      update: {
        event: {
          conversation: POSTING.id,
          event: { kind: "user", at: AT, id: "m1", text: "make it shorter", taken: true },
        },
      },
    });
    t.push({
      type: "update",
      update: { event: { conversation: POSTING.id, event: { kind: "text", at: AT, text: "Cut **two** bullets." } } },
    });
    expect(screen.queryByText("waiting for Claude")).toBeNull();
    expect(screen.getByText("two").tagName).toBe("STRONG");
    // Another conversation's events don't show here.
    t.push({
      type: "update",
      update: { event: { conversation: "general", event: { kind: "text", at: AT, text: "elsewhere" } } },
    });
    expect(screen.queryByText("elsewhere")).toBeNull();

    t.setState(
      state({
        agent: { status: "working", conversation: POSTING.id, queued: 0, settings: state().agent.settings },
      }),
    );
    t.push({ type: "update", update: { changed: true } });
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    await waitFor(() => expect(t.calls).toContainEqual(["panel.stop", {}]));
    expect((screen.getByRole("button", { name: /Tailor documents/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("answers a question card and decides an approval, with another conversation's card labelled", async () => {
    const ask: Card = {
      id: "ask-1",
      kind: "ask",
      conversation: POSTING.id,
      createdAt: AT,
      spec: {
        title: "Acme, step 3",
        questions: [
          {
            id: "auth",
            prompt: "Authorized to work here?",
            type: "single",
            options: [{ value: "Yes" }, { value: "No" }],
            proposed: "Yes",
            sensitive: true,
            why: "From your profile",
          },
          { id: "why", prompt: "Why us?", type: "text", required: false },
        ],
      },
    };
    const perm: Card = {
      id: "perm-1",
      kind: "permission",
      conversation: "general",
      createdAt: AT,
      toolName: "Bash",
      input: { command: "winget install MiKTeX.MiKTeX" },
      description: "Install TeX",
    };
    const t = fakeTransport({ state: state({ cards: [ask, perm] }) });
    render(<PanelApp transport={t.transport} />);
    expect(await screen.findByText("Needs you · 2")).toBeTruthy();
    expect(screen.getByText("sensitive")).toBeTruthy();
    expect(screen.getByText("From your profile")).toBeTruthy();
    expect(screen.getByText("winget install MiKTeX.MiKTeX")).toBeTruthy();
    expect(screen.getByText("General")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send answers" }));
    await waitFor(() =>
      expect(t.calls).toContainEqual([
        "panel.answer",
        { cardId: "ask-1", answers: { auth: { value: "Yes" }, why: { skipped: true } } },
      ]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Deny with a reason" }));
    fireEvent.change(screen.getByLabelText("Reason for denying"), { target: { value: "use the other installer" } });
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() =>
      expect(t.calls).toContainEqual([
        "panel.permission",
        { cardId: "perm-1", allow: false, reason: "use the other installer" },
      ]),
    );
  });

  it("checks a card's answers before sending, and replies in the chat instead when asked", async () => {
    const ask: Card = {
      id: "ask-2",
      kind: "ask",
      conversation: POSTING.id,
      createdAt: AT,
      spec: {
        title: "Step 1",
        questions: [{ id: "q", prompt: "Pick one", type: "single", options: [{ value: "A" }, { value: "B" }] }],
      },
    };
    const t = fakeTransport({ state: state({ cards: [ask] }) });
    render(<PanelApp transport={t.transport} />);
    fireEvent.click(await screen.findByRole("button", { name: "Send answers" }));
    expect(await screen.findByText("an answer is needed")).toBeTruthy();
    expect(t.calls.some(([m]) => m === "panel.answer")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Reply in chat instead" }));
    fireEvent.change(screen.getByLabelText("Reply in the chat"), { target: { value: "neither, ask me later" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reply" }));
    await waitFor(() =>
      expect(t.calls).toContainEqual(["panel.reply", { cardId: "ask-2", message: "neither, ask me later" }]),
    );
  });
});

describe("question drafts", () => {
  const single: AskQuestion = {
    id: "s",
    prompt: "?",
    type: "single",
    options: [{ value: "Yes" }, { value: "No" }],
    proposed: "Yes",
  };
  it("starts from the suggestion, as an option where it names one and as Other where it doesn't", () => {
    expect(initialDraft(single)).toMatchObject({ value: "Yes", useOther: false });
    expect(initialDraft({ ...single, proposed: "Maybe", allowOther: true })).toMatchObject({
      value: "",
      other: "Maybe",
      useOther: true,
    });
    expect(
      initialDraft({
        id: "m",
        prompt: "?",
        type: "multi",
        options: [{ value: "A" }, { value: "B" }],
        proposed: ["A", "Z"],
        allowOther: true,
      }),
    ).toMatchObject({ value: ["A"], other: "Z", useOther: true });
    expect(initialDraft({ id: "t", prompt: "?", type: "text", proposed: "Hello" })).toMatchObject({ value: "Hello" });
  });

  it("answers with the value, Other's text, a skip for an empty optional one, and remember only where offered", () => {
    expect(answerOf(single, { value: "No", other: "", useOther: false, remember: true })).toEqual({ value: "No" });
    expect(
      answerOf({ ...single, allowOther: true }, { value: "", other: "Later", useOther: true, remember: false }),
    ).toEqual({
      value: "Later",
      other: true,
    });
    expect(
      answerOf(
        { id: "t", prompt: "?", type: "text", required: false },
        { value: " ", other: "", useOther: false, remember: false },
      ),
    ).toEqual({
      skipped: true,
    });
    expect(
      answerOf(
        { id: "t", prompt: "?", type: "text", remember: { answerId: "x" } },
        { value: "v", other: "", useOther: false, remember: true },
      ),
    ).toEqual({ value: "v", remember: true });
  });

  it("shows an approval's command, or a file and its change, whole", () => {
    const base = { id: "p", kind: "permission" as const, createdAt: AT };
    expect(permissionBody({ ...base, toolName: "Bash", input: { command: "rm -r x" } })).toEqual({
      title: "Run a command",
      lines: [{ text: "rm -r x" }],
    });
    expect(
      permissionBody({ ...base, toolName: "Edit", input: { file_path: "a.tex", old_string: "x", new_string: "y" } })
        .lines,
    ).toEqual([
      { label: "File", text: "a.tex" },
      { label: "Replace", text: "x" },
      { label: "With", text: "y" },
    ]);
  });
});

describe("the conversation", () => {
  it("replaces a message when it's taken, folds tool calls with their errors, and shows each turn's cost", () => {
    let events: AgentEvent[] = [];
    events = withEvent(events, { kind: "user", at: AT, id: "a", text: "hi", taken: false });
    events = withEvent(events, { kind: "user", at: AT, id: "a", text: "hi", taken: true });
    expect(events).toHaveLength(1);
    events = [
      ...events,
      { kind: "tool", at: AT, id: "t1", name: "mcp__ezapply__tex_compile", summary: '{"path":"resume.tex"}' },
      { kind: "toolDone", at: AT, id: "t1", ok: false, error: "Undefined control sequence" },
      { kind: "turnEnd", at: AT, ok: true, totalCostUsd: 0.25 },
      { kind: "turnEnd", at: AT, ok: true, totalCostUsd: 0.4 },
      { kind: "notice", at: AT, level: "error", text: "Claude Code stopped unexpectedly: boom" },
    ];
    render(<Conversation events={events} />);
    expect(screen.getByText("tex_compile")).toBeTruthy();
    expect(screen.getByText("Undefined control sequence")).toBeTruthy();
    expect(screen.getByText("Done · $0.25")).toBeTruthy();
    expect(screen.getByText("Done · $0.15")).toBeTruthy();
    expect(screen.getByText(/stopped unexpectedly/)).toBeTruthy();
  });

  it("renders the agent's Markdown as elements, never its text as HTML", () => {
    const { container } = render(
      <Markdown text={"Hi <img src=x onerror=alert(1)>\n\n- one\n- **two**\n\n```\ncode\n```"} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("pre")?.textContent).toBe("code");
  });
});

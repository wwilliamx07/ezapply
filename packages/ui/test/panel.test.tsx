// @vitest-environment jsdom
import type { AgentEvent, AskQuestion, Card, PanelConversation, PanelState } from "@ezapply/protocol";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const TAILOR = `${POSTING.id}/tailor`;
const FILL = `${POSTING.id}/fill`;

function state(over: Partial<PanelState> = {}): PanelState {
  return {
    agent: {
      status: "idle",
      queued: 0,
      settings: { agent: "claude", permissionMode: "auto", model: "sonnet", effort: "medium" },
      agents: ["claude"],
    },
    activePostingId: POSTING.id,
    postings: [POSTING],
    cards: [],
    setup: { ready: true, left: [] },
    ...over,
  };
}
function conversation(over: Partial<PanelConversation> = {}): PanelConversation {
  return {
    key: TAILOR,
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
      // Only the conversation asked for, as the companion: a posting's other conversation has its posting and
      // documents but not its events, and a posting's never stands in for the general one.
      if (method === "panel.conversation") {
        const key = (params as { key: string }).key;
        if (key === cv.key) return cv;
        return key.startsWith(`${POSTING.id}/`) ? { ...cv, key, events: [] } : { key, documents: [], events: [] };
      }
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
    await waitFor(() =>
      expect((screen.getByRole("button", { name: /Fill form/ }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: /Fill form/ }));
    await waitFor(() => expect(t.calls.filter(([m]) => m === "panel.send")).toHaveLength(2));
    expect(t.calls.filter(([m]) => m === "panel.send").map(([, p]) => p)).toEqual([
      { key: TAILOR, text: REQUESTS.tailor },
      { key: FILL, text: REQUESTS.fill(7) },
    ]);
    // Filling shows the application's conversation.
    expect(screen.getByRole("tab", { name: "Application" }).getAttribute("aria-selected")).toBe("true");
  });

  it("blocks every way of starting a turn from the first press until the send is answered", async () => {
    const t = fakeTransport({
      tab: { kind: "application", text: "Acme: Software Developer: the application on Workday", tabId: 7 },
    });
    const call = t.transport.call;
    let answer: () => void = () => {};
    t.transport.call = vi.fn(async (method: string, params: unknown) => {
      if (method === "panel.send") await new Promise<void>((r) => (answer = r));
      return call(method as never, params as never);
    }) as PanelTransport["call"];
    render(<PanelApp transport={t.transport} />);
    const tailor = await screen.findByRole("button", { name: /Tailor documents/ });
    await screen.findByText(/the application on Workday/);
    await waitFor(() => expect((tailor as HTMLButtonElement).disabled).toBe(false));
    const box = screen.getByLabelText("Message");

    fireEvent.click(tailor);
    fireEvent.click(tailor);
    expect((tailor as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Fill form/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "and shorter" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);

    await act(async () => answer());
    await waitFor(() => expect((tailor as HTMLButtonElement).disabled).toBe(false));
    expect(t.calls.filter(([m]) => m === "panel.send")).toEqual([
      ["panel.send", { key: TAILOR, text: REQUESTS.tailor }],
    ]);
  });

  it("switches between a posting's documents and application conversations, following the one Claude works in", async () => {
    const t = fakeTransport({
      state: state({
        agent: {
          status: "working",
          conversation: FILL,
          queued: 0,
          settings: state().agent.settings,
          agents: ["claude"],
        },
      }),
    });
    render(<PanelApp transport={t.transport} />);
    const application = await screen.findByRole("tab", { name: /Application/ });
    expect(application.getAttribute("aria-selected")).toBe("true");
    expect(within(application).getByLabelText("Claude is working here")).toBeTruthy();
    await waitFor(() => expect(t.calls).toContainEqual(["panel.conversation", { key: FILL }]));
    fireEvent.click(screen.getByRole("tab", { name: "Documents" }));
    await waitFor(() => expect(t.calls).toContainEqual(["panel.conversation", { key: TAILOR }]));
    expect(screen.getByText(/Claude is working on Acme: Software Developer · Application/)).toBeTruthy();
  });

  it("shows each document as approved or waiting for review", async () => {
    const t = fakeTransport({
      conv: conversation({
        documents: [
          { file: "resume.pdf", state: "attached" },
          { file: "cover-letter.pdf", state: "draft" },
          { file: "bundle.pdf", state: "changes" },
        ],
      }),
    });
    render(<PanelApp transport={t.transport} />);
    expect(await screen.findByText("resume.pdf")).toBeTruthy();
    expect(screen.getAllByText("approved")).toHaveLength(1);
    expect(screen.getAllByText("waiting for your review")).toHaveLength(2);
    expect(screen.getByLabelText("Posting and documents, 2 waiting for your review")).toBeTruthy();
  });

  it("deletes an approved document and the posting after asking, and offers no trash on a document not approved", async () => {
    const t = fakeTransport({
      conv: conversation({
        documents: [
          { file: "resume.pdf", state: "approved" },
          { file: "cover-letter.pdf", state: "draft" },
        ],
      }),
    });
    render(<PanelApp transport={t.transport} />);
    expect(await screen.findByText("resume.pdf")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete cover-letter.pdf" })).toBeNull();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete resume.pdf" }));
    expect(t.calls.some(([m]) => m === "panel.deleteDocument")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete resume.pdf" }));
    await waitFor(() =>
      expect(t.calls).toContainEqual(["panel.deleteDocument", { postingId: POSTING.id, file: "resume.pdf" }]),
    );
    fireEvent.click(screen.getByRole("button", { name: /Delete posting/ }));
    await waitFor(() => expect(t.calls).toContainEqual(["panel.deletePosting", { postingId: POSTING.id }]));
    confirm.mockRestore();
  });

  it("opens the application when this tab isn't it, captures from the header, and resets after asking", async () => {
    const t = fakeTransport({ tab: { kind: "page", text: "Not this posting's application", tabId: 3 } });
    render(<PanelApp transport={t.transport} />);
    fireEvent.click(await screen.findByRole("button", { name: /Open the application/ }, { timeout: 5000 }));
    expect(t.transport.openTab).toHaveBeenCalledWith(POSTING.url);
    fireEvent.click(screen.getByRole("button", { name: /Capture/ }));
    expect(t.transport.capture).toHaveBeenCalledTimes(1);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset Conversation" }));
    await waitFor(() => expect(t.calls).toContainEqual(["panel.reset", { key: TAILOR }]), { timeout: 5000 });
    confirm.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Extension settings" }));
    expect(t.transport.openSettings).toHaveBeenCalledTimes(1);
  });

  it("resets the general conversation after asking, and offers no posting's actions there", async () => {
    const t = fakeTransport({
      state: state({ activePostingId: null }),
      conv: { key: "general", documents: [], events: [] },
    });
    render(<PanelApp transport={t.transport} />);
    expect(await screen.findByText(/No posting. Capture one/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Delete posting/ })).toBeNull();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset Conversation" }));
    await waitFor(() => expect(t.calls).toContainEqual(["panel.reset", { key: "general" }]));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/new general conversation/));
    confirm.mockRestore();
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
        agent: {
          ...state().agent,
          settings: { agent: "claude", permissionMode: "default", model: "sonnet", effort: "medium" },
        },
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

  it("offers the agent only when more than one is installed, and Antigravity's two modes and no model", async () => {
    const t = fakeTransport({});
    render(<PanelApp transport={t.transport} />);
    await screen.findByRole("combobox", { name: "Effort" });
    expect(screen.queryByRole("combobox", { name: "Agent" })).toBeNull();
    t.setState(
      state({
        agent: {
          ...state().agent,
          settings: { agent: "antigravity", permissionMode: "auto", model: "sonnet", effort: "max" },
          agents: ["claude", "antigravity"],
        },
      }),
    );
    t.push({ type: "update", update: { changed: true } });
    const agent = (await screen.findByRole("combobox", { name: "Agent" })) as HTMLSelectElement;
    expect(agent.value).toBe("antigravity");
    expect(screen.queryByRole("combobox", { name: "Model" })).toBeNull();
    const mode = screen.getByRole("combobox", { name: "Permission mode" }) as HTMLSelectElement;
    expect([...mode.options].map((o) => o.value)).toEqual(["plan", "dontAsk"]);
    expect(mode.value).toBe("dontAsk");
    const effort = screen.getByRole("combobox", { name: "Effort" }) as HTMLSelectElement;
    expect(effort.options.length).toBe(5);
    expect(effort.value).toBe("max");
    fireEvent.change(mode, { target: { value: "plan" } });
    await waitFor(() => expect(t.calls).toContainEqual(["panel.settings", { permissionMode: "plan" }]));
    fireEvent.change(agent, { target: { value: "claude" } });
    await waitFor(() => expect(t.calls).toContainEqual(["panel.settings", { agent: "claude" }]));
  });

  it("shows a settings change at once, before ezapply answers", async () => {
    const t = fakeTransport({
      state: state({ agent: { ...state().agent, agents: ["claude", "antigravity"] } }),
    });
    const call = t.transport.call as unknown as ReturnType<typeof vi.fn>;
    const inner = call.getMockImplementation() as (m: string, p: unknown) => Promise<unknown>;
    let answer = () => {};
    call.mockImplementation((m: string, p: unknown) =>
      m === "panel.settings" ? new Promise((r) => (answer = () => r(inner(m, p)))) : inner(m, p),
    );
    render(<PanelApp transport={t.transport} />);
    const agent = (await screen.findByRole("combobox", { name: "Agent" })) as HTMLSelectElement;
    fireEvent.change(agent, { target: { value: "antigravity" } });
    expect(agent.value).toBe("antigravity");
    expect(screen.queryByRole("combobox", { name: "Model" })).toBeNull();
    // ezapply kept the change: the state read after it says so.
    t.setState(
      state({
        agent: {
          ...state().agent,
          agents: ["claude", "antigravity"],
          settings: { ...state().agent.settings, agent: "antigravity" },
        },
      }),
    );
    answer();
    await waitFor(() => expect(t.calls.filter(([m]) => m === "panel.state").length).toBeGreaterThan(1));
    expect(agent.value).toBe("antigravity");
  });

  it("says when ezapply isn't running or the extension isn't paired, and disables the rest", async () => {
    const off = fakeTransport({ conn: { state: "disconnected", reason: "refused" } });
    const { unmount } = render(<PanelApp transport={off.transport} />);
    expect(await screen.findByText(/ezapply isn't running/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Capture/ }) as HTMLButtonElement).disabled).toBe(true);
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
    await waitFor(() => expect(t.calls).toContainEqual(["panel.send", { key: TAILOR, text: "make it shorter" }]));

    t.push({
      type: "update",
      update: {
        event: {
          conversation: TAILOR,
          event: { kind: "user", at: AT, id: "m1", text: "make it shorter", taken: false },
        },
      },
    });
    expect(await screen.findByText("waiting for Claude Code")).toBeTruthy();
    t.push({
      type: "update",
      update: {
        event: {
          conversation: TAILOR,
          event: { kind: "user", at: AT, id: "m1", text: "make it shorter", taken: true },
        },
      },
    });
    t.push({
      type: "update",
      update: { event: { conversation: TAILOR, event: { kind: "text", at: AT, text: "Cut **two** bullets." } } },
    });
    expect(screen.queryByText("waiting for Claude Code")).toBeNull();
    expect(screen.getByText("two").tagName).toBe("STRONG");
    // Another conversation's events don't show here.
    t.push({
      type: "update",
      update: { event: { conversation: "general", event: { kind: "text", at: AT, text: "elsewhere" } } },
    });
    expect(screen.queryByText("elsewhere")).toBeNull();

    t.setState(
      state({
        agent: {
          status: "working",
          conversation: TAILOR,
          queued: 0,
          settings: state().agent.settings,
          agents: ["claude"],
        },
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
      conversation: TAILOR,
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
    expect(within(screen.getByRole("region", { name: "Needs you" })).getByText("General")).toBeTruthy();

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
      conversation: TAILOR,
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

  it("names the agent a message is waiting for", () => {
    render(<Conversation events={[{ kind: "user", at: AT, id: "a", text: "hi", taken: false }]} agent="Antigravity" />);
    expect(screen.getByText("waiting for Antigravity")).toBeTruthy();
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

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskLine } from "../src/onboard/parts.js";
import { type Onboard, OnboardContext } from "../src/onboard/state.js";
import { CoverStep, LibraryStep, PreferencesStep } from "../src/onboard/steps-documents.js";
import { ReposStep, TexStep } from "../src/onboard/steps-setup.js";

// The bundle defines the PDF worker's address at build time (lib/pdf.ts); the step imports it with its previews.
vi.hoisted(() => {
  (globalThis as { __PDF_WORKER__?: string }).__PDF_WORKER__ = "";
});

// The previews load nothing here: the tests only see which address each asks for.
const { loadPdf } = vi.hoisted(() => ({ loadPdf: vi.fn((_url: string) => new Promise<never>(() => {})) }));
vi.mock("../src/lib/pdf.js", () => ({ loadPdf }));

afterEach(cleanup);

describe("the library step", () => {
  it("deletes a file only after the user confirms", async () => {
    const act = vi.fn(async () => ({ deleted: "library/transcript.pdf" }));
    const onboard = {
      base: "/onboard",
      state: { library: ["transcript.pdf"] },
      error: null,
      refresh: async () => {},
      act,
      ask: async () => {},
    } as unknown as Onboard;
    render(
      <OnboardContext.Provider value={onboard}>
        <LibraryStep />
      </OnboardContext.Provider>,
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const button = screen.getByRole("button", { name: "Delete transcript.pdf" });

    fireEvent.click(button);
    expect(confirm).toHaveBeenCalledWith("Delete transcript.pdf from your library for good?");
    expect(act).not.toHaveBeenCalled();

    fireEvent.click(button);
    await waitFor(() => expect(act).toHaveBeenCalledWith("deleteLibrary", { name: "transcript.pdf" }));
    confirm.mockRestore();
  });
});

describe("the preferences step", () => {
  it("saves the notifications setting as soon as it's changed, on its own", async () => {
    const act = vi.fn(async () => ({}));
    const onboard = {
      base: "/onboard",
      state: {
        steps: [],
        preferences: {
          attachMode: "after-approval",
          tone: "",
          emphasis: "",
          neverMention: "",
          targets: "",
          coverLetters: "",
        },
        notifications: { turnEnd: true },
        agentName: "Antigravity",
      },
      error: null,
      refresh: async () => {},
      act,
      ask: async () => {},
    } as unknown as Onboard;
    render(
      <OnboardContext.Provider value={onboard}>
        <PreferencesStep />
      </OnboardContext.Provider>,
    );
    const box = screen.getByRole("checkbox", {
      name: /Notify me when Antigravity finishes a reply or asks me something/,
    });
    expect((box as HTMLInputElement).checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(act).toHaveBeenCalledWith("notifications", { turnEnd: false }));
    expect(act).toHaveBeenCalledTimes(1);
  });
});

describe("the repositories step", () => {
  it("adds a public repository by its address and lists it ticked", async () => {
    const listed = [{ fullName: "jane/api", selected: true, suggested: true, private: false }];
    let list: unknown[] = listed;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json" } })),
    );
    const act = vi.fn(async () => {
      list = [...listed, { fullName: "acme/widgets", source: "public-url", selected: true, suggested: false }];
      return { added: "acme/widgets" };
    });
    const onboard = {
      base: "/onboard",
      state: { steps: [], github: { loggedIn: true }, agentName: "Claude Code" },
      error: null,
      refresh: async () => {},
      act,
      ask: async () => {},
    } as unknown as Onboard;
    render(
      <OnboardContext.Provider value={onboard}>
        <ReposStep />
      </OnboardContext.Provider>,
    );
    const field = await screen.findByLabelText("A public repository you contributed to but don't own");
    fireEvent.change(field, { target: { value: "https://github.com/acme/widgets" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("addRepo", { url: "https://github.com/acme/widgets" }));
    const box = await screen.findByRole("checkbox", { name: /acme\/widgets/ });
    expect((box as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("added by address")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save 2 repositories" })).toBeTruthy();
    vi.unstubAllGlobals();
  });
});

describe("a task's line", () => {
  it("names the agent in use, not Claude", () => {
    const task = { id: "t1", kind: "index-repos", params: {}, status: "running", createdAt: "" } as const;
    render(<TaskLine task={task} agent={{ agentListening: true, agentIn: "panel", agentName: "Antigravity" }} />);
    expect(screen.getByText(/^Antigravity is working on it\./)).toBeTruthy();
    expect(screen.queryByText(/Claude/)).toBeNull();
  });
});

describe("the cover letter step", () => {
  function cover(builtAt: string): Onboard {
    return {
      base: "/onboard",
      state: {
        steps: [],
        tasks: [],
        agentName: "Claude Code",
        agentIn: "panel",
        profile: { valid: true },
        resume: { main: "templates/resume/resume.tex" },
        cover: { main: "templates/cover/cover.tex", isDefault: false, pdf: "templates/cover/cover.pdf", builtAt },
      },
      error: null,
      refresh: async () => {},
      act: async () => ({}),
      ask: async () => {},
    } as unknown as Onboard;
  }

  it("has no request box, and reloads its preview when the PDF is rebuilt, by the agent in chat too", async () => {
    const { rerender } = render(
      <OnboardContext.Provider value={cover("2026-01-01T00:00:00.000Z")}>
        <CoverStep />
      </OnboardContext.Provider>,
    );
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(/Ask Claude Code in the ezapply panel/)).toBeTruthy();
    await waitFor(() => expect(loadPdf).toHaveBeenCalledTimes(1));
    expect(loadPdf.mock.calls[0]?.[0]).toContain("v=2026-01-01T00%3A00%3A00.000Z");

    rerender(
      <OnboardContext.Provider value={cover("2026-01-02T00:00:00.000Z")}>
        <CoverStep />
      </OnboardContext.Provider>,
    );
    await waitFor(() => expect(loadPdf).toHaveBeenCalledTimes(2));
    expect(loadPdf.mock.calls[1]?.[0]).toContain("v=2026-01-02T00%3A00%3A00.000Z");
  });
});

describe("the LaTeX step", () => {
  function tex(over: Record<string, unknown>, act = vi.fn(async () => ({}))): Onboard {
    return {
      base: "/onboard",
      state: {
        steps: [],
        tasks: [],
        agentName: "Claude Code",
        agentIn: "panel",
        tex: { done: false, detail: "", installCommand: "winget install --id MiKTeX.MiKTeX", ...over },
      },
      error: null,
      refresh: async () => {},
      act,
      ask: async () => {},
    } as unknown as Onboard;
  }

  it("installs it with one press, by ezapply rather than the agent, and shows a failure's reason", async () => {
    const act = vi.fn(async () => ({}));
    const { rerender } = render(
      <OnboardContext.Provider value={tex({ canInstall: true }, act)}>
        <TexStep />
      </OnboardContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Install it" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("installTex"));

    rerender(
      <OnboardContext.Provider value={tex({ canInstall: true, install: { status: "running" } }, act)}>
        <TexStep />
      </OnboardContext.Provider>,
    );
    expect((screen.getByRole("button", { name: /Installing/ }) as HTMLButtonElement).disabled).toBe(true);

    rerender(
      <OnboardContext.Provider
        value={tex({ canInstall: true, install: { status: "failed", error: "The install didn't finish." } }, act)}
      >
        <TexStep />
      </OnboardContext.Provider>,
    );
    expect(screen.getByText("The install didn't finish.")).toBeTruthy();
  });

  it("only shows the command where ezapply can't install it", () => {
    render(
      <OnboardContext.Provider value={tex({ canInstall: false })}>
        <TexStep />
      </OnboardContext.Provider>,
    );
    expect(screen.queryByRole("button", { name: "Install it" })).toBeNull();
    expect(screen.getByText(/Run it in a terminal/)).toBeTruthy();
  });
});

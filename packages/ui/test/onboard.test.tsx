// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskLine } from "../src/onboard/parts.js";
import { type Onboard, OnboardContext } from "../src/onboard/state.js";
import { LibraryStep, PreferencesStep } from "../src/onboard/steps-documents.js";

// The bundle defines the PDF worker's address at build time (lib/pdf.ts); the step imports it with its previews.
vi.hoisted(() => {
  (globalThis as { __PDF_WORKER__?: string }).__PDF_WORKER__ = "";
});

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

describe("a task's line", () => {
  it("names the agent in use, not Claude", () => {
    const task = { id: "t1", kind: "question", params: {}, status: "running", createdAt: "" } as const;
    render(<TaskLine task={task} agent={{ agentListening: true, agentIn: "panel", agentName: "Antigravity" }} />);
    expect(screen.getByText(/^Antigravity is working on it\./)).toBeTruthy();
    expect(screen.queryByText(/Claude/)).toBeNull();
  });
});

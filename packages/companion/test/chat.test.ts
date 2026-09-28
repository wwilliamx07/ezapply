import { describe, expect, it } from "vitest";
import { ChatSessions, chatSessionId, toolCallCount } from "../src/chat.js";

describe("chat sessions", () => {
  it("tracks whether a session has used a tool and how many calls are running", () => {
    const chat = new ChatSessions();
    expect(chat.state("session-a")).toEqual({ used: false, inFlight: 0 });
    const endFirst = chat.beginToolCall("session-a");
    const endSecond = chat.beginToolCall("session-a");
    expect(chat.state("session-a")).toEqual({ used: true, inFlight: 2 });
    endFirst();
    endFirst(); // ending twice counts once
    expect(chat.state("session-a")).toEqual({ used: true, inFlight: 1 });
    endSecond();
    expect(chat.state("session-a")).toEqual({ used: true, inFlight: 0 });
    expect(chat.state("session-b")).toEqual({ used: false, inFlight: 0 });
  });

  it("counts only tools/call in a message or batch, and accepts only plain session ids", () => {
    expect(toolCallCount({ method: "tools/call" })).toBe(1);
    expect(toolCallCount([{ method: "tools/call" }, { method: "tools/list" }, { method: "tools/call" }])).toBe(2);
    expect(toolCallCount({ method: "initialize" })).toBe(0);
    expect(toolCallCount(null)).toBe(0);
    expect(chatSessionId("0b7c7f1e-4a52-4b8e-9d0e-6d4f3c2a1b00")).toBe("0b7c7f1e-4a52-4b8e-9d0e-6d4f3c2a1b00");
    expect(chatSessionId(["session-one-x", "session-two-x"])).toBe("session-one-x");
    expect(chatSessionId("short")).toBeUndefined();
    expect(chatSessionId("has spaces and ; semicolons")).toBeUndefined();
    expect(chatSessionId(undefined)).toBeUndefined();
  });
});

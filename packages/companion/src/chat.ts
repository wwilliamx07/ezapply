import type { PostingsService } from "./postings/service.js";
import type { Workspace } from "./workspace/workspace.js";

/** Header the MCP relay adds when it runs under `ezapply chat`, naming that chat session. */
export const CHAT_SESSION_HEADER = "x-ezapply-chat-session";

const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;
const FORGET_AFTER_MS = 24 * 60 * 60_000;

/** The session id from a request header, or undefined when it's missing or malformed. */
export function chatSessionId(header: string | string[] | undefined): string | undefined {
  const id = Array.isArray(header) ? header[0] : header;
  return id && SESSION_ID.test(id) ? id : undefined;
}

export interface ChatSessionState {
  /** At least one tool call has come from this session. */
  used: boolean;
  /** Tool calls from this session that haven't answered yet. */
  inFlight: number;
}

/**
 * What `ezapply chat` needs to know about its Claude session to restart it safely: whether the session has
 * done anything, and whether a tool call is running (a fill or a build must not be cut in half). The relay
 * tags every MCP request with the session id; only `tools/call` counts, since Claude Code lists tools and
 * initializes on its own at startup. Nothing is persisted: the sessions live as long as `ezapply chat`.
 */
export class ChatSessions {
  private readonly sessions = new Map<string, { calls: number; inFlight: number; seenAt: number }>();
  private readonly listeners = new Set<() => void>();

  /** A tool call from `id` starts; call the returned function once when it has answered. */
  beginToolCall(id: string): () => void {
    this.prune();
    const s = this.sessions.get(id) ?? { calls: 0, inFlight: 0, seenAt: 0 };
    s.calls++;
    s.inFlight++;
    s.seenAt = Date.now();
    this.sessions.set(id, s);
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      s.inFlight--;
      s.seenAt = Date.now();
      for (const fn of [...this.listeners]) fn();
    };
  }

  state(id: string): ChatSessionState {
    const s = this.sessions.get(id);
    return { used: (s?.calls ?? 0) > 0, inFlight: s?.inFlight ?? 0 };
  }

  /** Call `fn` whenever a tool call ends. Returns the function that stops it. */
  onCallEnd(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private prune(): void {
    const cutoff = Date.now() - FORGET_AFTER_MS;
    for (const [id, s] of this.sessions) if (s.inFlight === 0 && s.seenAt < cutoff) this.sessions.delete(id);
  }
}

/** Number of `tools/call` requests in a JSON-RPC message or batch. */
export function toolCallCount(body: unknown): number {
  const msgs = Array.isArray(body) ? body : [body];
  return msgs.filter((m) => (m as { method?: unknown } | null)?.method === "tools/call").length;
}

/** The active posting, as the restart message names it. */
export interface PostingRef {
  id: string;
  company?: string;
  role?: string;
}

/** What `ezapply chat` reads from the companion it hosts to decide when to restart Claude. */
export interface ChatHost {
  activePosting(): Promise<PostingRef | null>;
  session(id: string): ChatSessionState;
  /** `context.restartOnCapture` in ezapply.config.json (default on). */
  restartOnCapture(): Promise<boolean>;
  /** Call `fn` when the active posting changes or a tool call ends. Returns the function that stops it. */
  onChange(fn: () => void): () => void;
}

export function chatHost(postings: PostingsService, workspace: Workspace, sessions: ChatSessions): ChatHost {
  return {
    activePosting: async () => {
      const id = await postings.activeId();
      const meta = id ? await postings.get(id).catch(() => null) : null;
      if (!meta) return null;
      return {
        id: meta.id,
        ...(meta.company ? { company: meta.company } : {}),
        ...(meta.role ? { role: meta.role } : {}),
      };
    },
    session: (id) => sessions.state(id),
    restartOnCapture: async () => (await workspace.readConfig().catch(() => null))?.context.restartOnCapture ?? true,
    onChange: (fn) => {
      const stopPostings = postings.onActiveChange(fn);
      const stopCalls = sessions.onCallEnd(fn);
      return () => {
        stopPostings();
        stopCalls();
      };
    },
  };
}

import type { AgentEffort, AgentPermissionMode, AgentSettings, ConversationPart } from "@ezapply/protocol";
import type { StreamItem } from "./stream.js";

/**
 * The coding agent behind the panel, as `AgentService` sees it: something that starts one conversation's session
 * in the workspace and reports what it does as `StreamItem`s. Claude Code's is `claudeBackend` (`process.ts`),
 * Antigravity's `antigravityBackend`, Codex's `codexBackend`; each reads its own protocol into the same items.
 */
export interface AgentBackend {
  /** The agent's name as the panel's notices say it ("Claude Code stopped unexpectedly…"). */
  readonly name: string;
  /**
   * Whether a running session takes a new permission mode and model (`setPermissionMode`, `setModel`). Without
   * (`false`), a change ends the process and the next message continues the conversation with the new settings.
   */
  readonly switches?: boolean;
  start(opts: AgentSessionOptions): AgentSession;
  /**
   * The models it offers beyond the panel's fixed ones (Antigravity's depend on the account, so it lists them);
   * without, the panel offers its own list (Claude Code's aliases).
   */
  models?(env?: NodeJS.ProcessEnv): Promise<AgentModelOption[]>;
}

/** A model as the panel offers it: the id the agent takes, and its name. */
export interface AgentModelOption {
  id: string;
  label: string;
}

export interface AgentSessionOptions {
  cwd: string;
  /** ezapply's id for the session (the MCP relay sends it with each call). */
  sessionId: string;
  /** Continue an existing session rather than start one with this id. */
  resume: boolean;
  /**
   * The agent's own id for the session, when it isn't `sessionId` (an agent that names its sessions itself reports
   * it with an `agentSession` item); what a resume continues.
   */
  agentSessionId?: string;
  /** The permission mode, model and effort it starts with (the panel's settings). */
  settings: AgentSettings;
  /** A posting's conversation: which part, for its line of the system prompt. */
  part?: ConversationPart;
  env?: NodeJS.ProcessEnv;
  /**
   * An approval the agent asks of the client itself (Codex), shown as the panel's approval card; resolves with the
   * user's decision, a deny's `message` being what the agent is told. Claude Code asks through `permission_ask` instead.
   */
  approve?: (req: ApprovalRequest) => Promise<{ behavior: "allow" } | { behavior: "deny"; message: string }>;
  onItem: (item: StreamItem) => void;
  onExit: (code: number | null, stderrTail: string) => void;
}

/** What an approval card shows: the tool, what it would run or change, and the agent's reason. */
export interface ApprovalRequest {
  toolName: string;
  input: unknown;
  description?: string;
}

/** One conversation's running agent: messages in, items out through `onItem`, `onExit` once when it ends. */
export interface AgentSession {
  readonly alive: boolean;
  /** A user message: taken now, or while a turn runs when the agent can take it (a `taken` item says when). */
  send(text: string): void;
  /** End the running turn; its `turnEnd` follows. */
  interrupt(): void;
  /** Switch mid-session. Returns the request's id, answered by a `controlResponse` item. */
  setPermissionMode(mode: AgentPermissionMode): string;
  setModel(model: string): string;
  /** Switch the effort mid-session, when the agent can (Codex, from its next turn); without, the process restarts. */
  setEffort?(effort: AgentEffort): string;
  /** End it once idle; kill it if it hasn't exited after `graceMs`. */
  close(graceMs?: number): Promise<void>;
  /** End it at once, with whatever it started. */
  kill(): void;
}

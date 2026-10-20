import { existsSync } from "node:fs";
import { win32 } from "node:path";
import {
  type AgentPermissionMode,
  type AgentSettings,
  type ConversationPart,
  DEFAULT_AGENT_CHOICES,
} from "@ezapply/protocol";
import { SESSION_ENV } from "../endpoints.js";
import { which } from "../util/proc.js";
import type { AgentBackend, AgentSession, AgentSessionOptions } from "./backend.js";
import { type AgentCommand, findCommand, LineProcess } from "./child.js";
import { readStreamLine } from "./stream.js";

/** How to run Claude Code: the native `claude.exe`, or the npm install's `claude.cmd` (only runs through cmd). */
export type ClaudeCommand = AgentCommand;

/** Claude Code on PATH (or EZAPPLY_CLAUDE): the native `claude.exe`, or the npm install's `claude.cmd` on Windows. */
export function findClaude(env: NodeJS.ProcessEnv = process.env, platform = process.platform): ClaudeCommand | null {
  return findCommand("claude", "EZAPPLY_CLAUDE", env, platform);
}

const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;

/** The session id from a request header, or undefined when it's missing or malformed. */
export function sessionId(header: string | string[] | undefined): string | undefined {
  const id = Array.isArray(header) ? header[0] : header;
  return id && SESSION_ID.test(id) ? id : undefined;
}

/** The permission prompt tool Claude Code asks instead of a terminal dialog (served by `mcp/tools/agent.ts`). */
const PERMISSION_TOOL = "mcp__ezapply__permission_ask";

/** A conversation's options (`part` picks its line of `PART_PROMPTS`), with the Claude Code to run. */
interface AgentProcessOptions extends AgentSessionOptions {
  claude: ClaudeCommand;
}

/** Claude Code as the panel's agent: one `AgentProcess` per conversation. */
export function claudeBackend(claude: ClaudeCommand): AgentBackend {
  return { name: "Claude Code", start: (opts) => new AgentProcess({ ...opts, claude }) };
}

/**
 * The arguments of a conversation's Claude Code process. Why each:
 * - `-p` with stream-json both ways: messages arrive on stdin as JSON lines and the process stays up between
 *   turns while stdin is open, so a conversation is one process; `--verbose` is required for stream-json output.
 * - `--replay-user-messages`: each message is echoed when Claude takes it, so the panel can mark it taken (a
 *   message sent while a tool runs waits for the tool to end).
 * - `--permission-mode`, `--model` and `--effort` from the panel's settings, always, so the user's own Claude Code
 *   defaults don't decide them behind the panel.
 * - `--permission-prompt-tool`: what would prompt in the terminal asks the panel instead.
 * - `--append-system-prompt`: `PANEL_PROMPT`, and for a posting's conversation its part's line (`PART_PROMPTS`).
 * - The user's own Claude Code setup stays out (`PANEL_SCOPE`): it was half of every call's starting context.
 * - Not `--bare`: bare mode skips the workspace's skills, `.mcp.json` and settings, and the subscription login.
 */
export function agentArgs(
  sessionId: string,
  resume: boolean,
  settings: AgentSettings = { agent: "claude", ...DEFAULT_AGENT_CHOICES.claude },
  part?: ConversationPart,
  shell: PanelShell = "Bash",
): string[] {
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--replay-user-messages",
    "--permission-mode",
    settings.permissionMode,
    "--model",
    settings.model ?? "sonnet",
    "--effort",
    settings.effort,
    "--permission-prompt-tool",
    PERMISSION_TOOL,
    ...PANEL_SCOPE,
    "--tools",
    [shell, ...PANEL_TOOLS].join(","),
    "--append-system-prompt",
    part ? `${PANEL_PROMPT} ${PART_PROMPTS[part]}` : PANEL_PROMPT,
    ...(resume ? ["--resume", sessionId] : ["--session-id", sessionId]),
  ];
}

/**
 * What the panel's Claude Code loads beyond the workspace: nothing. The user's own MCP servers (claude.ai connectors
 * among them), plugins and user-level skills cost tokens on every call, and a document skill of theirs that claims
 * resumes and cover letters competes with ezapply's. Only `.mcp.json`'s servers, and the project and local settings
 * (the workspace's permission rules, and the approvals the user saved there); the subscription login isn't a setting
 * and still applies. Bundled skills go too (`DISABLE_BUNDLED_SKILLS`, an environment variable).
 */
const PANEL_SCOPE = ["--strict-mcp-config", "--mcp-config", ".mcp.json", "--setting-sources", "project,local"];

/** Claude Code's switch for its bundled skills, set on the panel's process. */
const DISABLE_BUNDLED_SKILLS = "CLAUDE_CODE_DISABLE_BUNDLED_SKILLS";

/**
 * The built-in tools the panel's work uses, beside one shell (`panelShell`); the rest are schemas re-read on every
 * call. AskUserQuestion isn't among them: questions go through `ask_user`, which holds a whole step's questions and
 * text answers. Agent stays for repo indexing and other large reading jobs.
 */
export const PANEL_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Skill", "ToolSearch", "Agent"];

type PanelShell = "Bash" | "PowerShell";

/**
 * One shell, not both: each is a large schema. Bash where Claude Code can run it, since the workspace's rules are
 * written for it (no `python` for edits); on Windows that needs Git Bash, and without it PowerShell.
 */
export function panelShell(
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  find: (bin: string) => string | null = which,
  exists: (path: string) => boolean = existsSync,
): PanelShell {
  if (platform !== "win32") return "Bash";
  if (env.CLAUDE_CODE_GIT_BASH_PATH && exists(env.CLAUDE_CODE_GIT_BASH_PATH)) return "Bash";
  const git = find("git");
  // Git for Windows puts git.exe in cmd\ (or bin\), and bash.exe in bin\ beside it.
  return git && exists(win32.join(win32.dirname(win32.dirname(git)), "bin", "bash.exe")) ? "Bash" : "PowerShell";
}

/**
 * Appended to Claude Code's system prompt: where its words go. The skills already say what to do; this says that
 * the user reads it in a narrow panel and answers questions on cards there, and that no terminal is watched.
 */
export const PANEL_PROMPT =
  "You are running headless behind ezapply's side panel in the user's browser: the user reads your messages there " +
  "and never sees a terminal. Put questions you need answered on a card with ask_user (a whole step's questions in " +
  "one call); a plain question in your message is fine when an open-ended reply is wanted, since the user can answer " +
  "in the panel's chat. When ask_user or review_documents returns pending, end your turn: the answer comes as your " +
  "next message. Commands that need approval are approved on the panel. Keep messages short: the panel is narrow.";

/**
 * A posting's two conversations, one for its documents and one for its application, whichever the user starts
 * first: each line keeps its conversation to its part, and sends the user to the other for the rest.
 */
export const PART_PROMPTS: Record<ConversationPart, string> = {
  tailor:
    "This conversation prepares its posting's documents (resume, cover letter, bundle) and their review. " +
    "Its application is filled in a separate conversation: don't fill, read or navigate application forms here. " +
    "When the user wants the application filled, tell them to press Fill form in the panel.",
  fill:
    "This conversation fills its posting's application. Its documents are written in a separate " +
    "conversation: don't write or edit a resume, cover letter or bundle here; you may show the ones already there " +
    "for review and attach them. When a document is missing, or the user asks for changes to one, tell them to " +
    "press Tailor documents in the panel (with their changes, if they asked for any), and fill the rest of the " +
    "form meanwhile. The form's own text (experience descriptions, free-text answers) is yours to tailor here.",
};

/** One conversation's Claude Code process: messages in, stream items out. */
class AgentProcess implements AgentSession {
  private readonly child: LineProcess;
  private controlSeq = 0;

  constructor(opts: AgentProcessOptions) {
    const base = opts.env ?? process.env;
    const env: NodeJS.ProcessEnv = { ...base, [SESSION_ENV]: opts.sessionId, [DISABLE_BUNDLED_SKILLS]: "1" };
    // A long MCP call (a permission prompt waiting on its card) must hold the turn, which is -p's default; the
    // user's own setting to background such calls would end the turn with the approval open.
    delete env.CLAUDE_AUTO_BACKGROUND_TASKS;
    this.child = new LineProcess({
      command: opts.claude,
      args: agentArgs(opts.sessionId, opts.resume, opts.settings, opts.part, panelShell(base)),
      cwd: opts.cwd,
      env,
      onLine: (line) => {
        for (const item of readStreamLine(line)) opts.onItem(item);
      },
      onExit: opts.onExit,
    });
  }

  get alive(): boolean {
    return this.child.alive;
  }

  /** A user message, as a JSON line. Claude takes it now, or at the next tool call's end while a turn runs. */
  send(text: string): void {
    this.write({ type: "user", message: { role: "user", content: text } });
  }

  /** End the running turn (a running tool call's result is dropped). Returns the request's id. */
  interrupt(): string {
    const id = `interrupt-${++this.controlSeq}`;
    this.write({ type: "control_request", request_id: id, request: { subtype: "interrupt" } });
    return id;
  }

  /** Switch the permission mode mid-session (Claude Code's `set_permission_mode`). Returns the request's id. */
  setPermissionMode(mode: AgentPermissionMode): string {
    const id = `mode-${++this.controlSeq}`;
    this.write({ type: "control_request", request_id: id, request: { subtype: "set_permission_mode", mode } });
    return id;
  }

  /** Switch the model mid-session (`set_model`). Returns the request's id. */
  setModel(model: string): string {
    const id = `model-${++this.controlSeq}`;
    this.write({ type: "control_request", request_id: id, request: { subtype: "set_model", model } });
    return id;
  }

  /** Close stdin, which ends the process once it's idle; kill it if it hasn't exited after `graceMs`. */
  close(graceMs?: number): Promise<void> {
    return this.child.close(graceMs);
  }

  /** The whole tree: Claude and what it started (its MCP relay, a running command). */
  kill(): void {
    this.child.kill();
  }

  private write(o: unknown): void {
    this.child.write(o);
  }
}

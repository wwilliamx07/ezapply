import { z } from "zod";
import { FrameInfo } from "./browser.js";
import { PostingStatus, SiteId } from "./postings.js";

/**
 * The extension's side panel and the agent behind it: the companion runs Claude Code headless and relays what it
 * does to the panel as events, and what it asks (questions, approvals) as cards the user answers there.
 */

/** The conversation for work with no posting. */
export const GENERAL_CONVERSATION = "general";

/**
 * A posting has two conversations, whichever comes first: `tailor` writes its documents, `fill` fills its
 * application. Each keeps its own context, so a long form doesn't crowd the documents' work, or the reverse.
 */
export const ConversationPart = z.enum(["tailor", "fill"]);
export type ConversationPart = z.infer<typeof ConversationPart>;

/** A posting conversation's key: `<posting id>/<part>`. */
export function conversationKey(postingId: string, part: ConversationPart): string {
  return `${postingId}/${part}`;
}

/** The posting and part a conversation key names; null for `general` or a key that isn't one. */
export function postingConversation(key: string): { postingId: string; part: ConversationPart } | null {
  const m = /^([\w.-]+)\/(tailor|fill)$/.exec(key);
  const postingId = m?.[1];
  if (!postingId || postingId.startsWith(".")) return null;
  return { postingId, part: m[2] as ConversationPart };
}

// ---- ask_user: the agent's questions ----

export const AskOption = z.object({
  value: z.string().min(1).max(500),
  label: z.string().max(500).optional(),
  description: z.string().max(1000).optional(),
});
export type AskOption = z.infer<typeof AskOption>;

export const AskQuestion = z.object({
  id: z.string().min(1).max(100),
  prompt: z.string().min(1).max(2000),
  type: z.enum(["single", "multi", "text"]),
  /** single and multi. */
  options: z.array(AskOption).min(2).max(50).optional(),
  /** single and multi: a free-text "Other". */
  allowOther: z.boolean().optional(),
  /** multi: how many may be chosen. */
  min: z.number().int().min(0).optional(),
  max: z.number().int().min(1).optional(),
  /** text. */
  multiline: z.boolean().optional(),
  placeholder: z.string().max(200).optional(),
  maxLength: z.number().int().min(1).max(20_000).optional(),
  /** Filled in on the card and marked as the agent's suggestion. */
  proposed: z.union([z.string().max(20_000), z.array(z.string().max(500)).max(50)]).optional(),
  /** Where the suggestion came from, or why it's asked. */
  why: z.string().max(1000).optional(),
  /** Flagged on the card (EEO, salary, disability, anything marked sensitive). May still carry a suggestion. */
  sensitive: z.boolean().optional(),
  /** Default true; an optional question can be skipped. */
  required: z.boolean().optional(),
  /** Offers "Save for next time" into the answer bank, under this answer id. */
  remember: z.object({ answerId: z.string().min(1).max(200) }).optional(),
});
export type AskQuestion = z.infer<typeof AskQuestion>;

export const AskSpec = z.object({
  title: z.string().min(1).max(200),
  intro: z.string().max(2000).optional(),
  questions: z.array(AskQuestion).min(1).max(25),
});
export type AskSpec = z.infer<typeof AskSpec>;

export const AskAnswer = z.union([
  z.object({
    value: z.union([z.string().max(20_000), z.array(z.string().max(20_000)).max(50)]),
    /** The value is the user's own text for "Other". */
    other: z.literal(true).optional(),
    /** Save it into the answer bank (the question's `remember`). */
    remember: z.literal(true).optional(),
  }),
  z.object({ skipped: z.literal(true) }),
]);
export type AskAnswer = z.infer<typeof AskAnswer>;
export const AskAnswers = z.record(z.string(), AskAnswer);
export type AskAnswers = z.infer<typeof AskAnswers>;

/**
 * What doesn't fit a schema in an ask: options for single and multi, unique ids, a suggestion that's one of the
 * options unless "Other" is allowed, min ≤ max. Returns the problems, empty when the spec is fine.
 */
export function askSpecProblems(spec: AskSpec): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const q of spec.questions) {
    if (ids.has(q.id)) out.push(`${q.id}: the id is used twice`);
    ids.add(q.id);
    if (q.type === "text") {
      if (q.options) out.push(`${q.id}: a text question has no options`);
      if (Array.isArray(q.proposed)) out.push(`${q.id}: a text question's suggestion is one string`);
      continue;
    }
    if (!q.options) {
      out.push(`${q.id}: a ${q.type} question needs options`);
      continue;
    }
    const values = new Set(q.options.map((o) => o.value));
    if (values.size !== q.options.length) out.push(`${q.id}: two options have the same value`);
    if (q.type === "single" && Array.isArray(q.proposed))
      out.push(`${q.id}: a single question's suggestion is one value`);
    if (q.min !== undefined && q.max !== undefined && q.min > q.max) out.push(`${q.id}: min is more than max`);
    if (q.type === "single" && (q.min !== undefined || q.max !== undefined))
      out.push(`${q.id}: min and max are for multi`);
    const proposed = q.proposed === undefined ? [] : Array.isArray(q.proposed) ? q.proposed : [q.proposed];
    if (!q.allowOther) {
      for (const p of proposed) if (!values.has(p)) out.push(`${q.id}: the suggestion "${p}" isn't one of the options`);
    }
  }
  return out;
}

/** What's wrong with answers to a spec: a required question unanswered, a value no option has, too few or many. */
export function askAnswerProblems(spec: AskSpec, answers: AskAnswers): string[] {
  const out: string[] = [];
  for (const q of spec.questions) {
    const a = answers[q.id];
    const required = q.required !== false;
    if (!a || "skipped" in a) {
      if (required) out.push(`${q.id}: an answer is needed`);
      continue;
    }
    const values = (Array.isArray(a.value) ? a.value : [a.value]).filter((v) => v.trim() !== "");
    if (q.type !== "text" && values.length === 0) {
      if (required || q.type === "single") out.push(`${q.id}: an answer is needed`);
      continue;
    }
    if (q.type === "text") {
      if (Array.isArray(a.value)) out.push(`${q.id}: a text answer is one string`);
      else if (required && !a.value.trim()) out.push(`${q.id}: an answer is needed`);
      else if (q.maxLength !== undefined && a.value.length > q.maxLength)
        out.push(`${q.id}: longer than ${q.maxLength}`);
      continue;
    }
    if (q.type === "single" && values.length !== 1) out.push(`${q.id}: choose one`);
    if (a.other) {
      if (!q.allowOther) out.push(`${q.id}: this question has no "Other"`);
    } else {
      const known = new Set((q.options ?? []).map((o) => o.value));
      for (const v of values) if (!known.has(v)) out.push(`${q.id}: "${v}" isn't one of the options`);
    }
    if (q.type === "multi") {
      if (q.min !== undefined && values.length < q.min) out.push(`${q.id}: choose at least ${q.min}`);
      if (q.max !== undefined && values.length > q.max) out.push(`${q.id}: choose at most ${q.max}`);
    }
    if (a.remember && !q.remember) out.push(`${q.id}: this answer can't be saved`);
  }
  for (const id of Object.keys(answers)) {
    if (!spec.questions.some((q) => q.id === id)) out.push(`${id}: no such question`);
  }
  return out;
}

// ---- cards: what waits on the user ----

export const AskCard = z.object({
  id: z.string(),
  kind: z.literal("ask"),
  conversation: z.string().optional(),
  createdAt: z.string(),
  spec: AskSpec,
});
export type AskCard = z.infer<typeof AskCard>;

export const PermissionCard = z.object({
  id: z.string(),
  kind: z.literal("permission"),
  conversation: z.string().optional(),
  createdAt: z.string(),
  toolName: z.string(),
  /** What the tool would run, for the user to read: the command, or the file and the change. */
  input: z.unknown(),
  /** The agent's own description of the call, when it gave one. */
  description: z.string().optional(),
});
export type PermissionCard = z.infer<typeof PermissionCard>;

export const Card = z.discriminatedUnion("kind", [AskCard, PermissionCard]);
export type Card = z.infer<typeof Card>;

// ---- the agent's conversation, as the panel shows it ----

const at = z.string();
export const AgentEvent = z.discriminatedUnion("kind", [
  /**
   * A message the user sent; `taken` once Claude has it (it may wait for a running tool call). `delivery`: ezapply
   * sent it, carrying a result the user gave elsewhere (an ask's answers, a review), and `text` says which.
   */
  z.object({
    kind: z.literal("user"),
    at,
    id: z.string(),
    text: z.string(),
    taken: z.boolean().optional(),
    delivery: z.boolean().optional(),
  }),
  /** Claude's text. `parent`: the subagent call it came from. */
  z.object({ kind: z.literal("text"), at, text: z.string(), parent: z.string().optional() }),
  /** A tool call, folded to one line. */
  z.object({
    kind: z.literal("tool"),
    at,
    id: z.string(),
    name: z.string(),
    summary: z.string(),
    parent: z.string().optional(),
  }),
  /** A tool call's end. `error`: the start of its error, when it failed. */
  z.object({ kind: z.literal("toolDone"), at, id: z.string(), ok: z.boolean(), error: z.string().optional() }),
  /** A card answered or withdrawn, kept as a record in the conversation. */
  z.object({ kind: z.literal("card"), at, cardId: z.string(), title: z.string(), outcome: z.string() }),
  /** The end of a turn. `totalCostUsd` is the session's so far (Claude Code's estimate). */
  z.object({
    kind: z.literal("turnEnd"),
    at,
    ok: z.boolean(),
    interrupted: z.boolean().optional(),
    totalCostUsd: z.number().optional(),
    durationMs: z.number().optional(),
    error: z.string().optional(),
  }),
  /** Something the user should know: a retry, a missing tool server, Claude stopping. */
  z.object({ kind: z.literal("notice"), at, level: z.enum(["info", "warn", "error"]), text: z.string() }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;

export const AgentStatus = z.enum(["idle", "starting", "working", "unavailable"]);
export type AgentStatus = z.infer<typeof AgentStatus>;

/**
 * Claude Code permission modes the panel offers. `auto` (the default) has Claude Code's classifier decide what runs
 * without asking; `default` asks on the panel for whatever the workspace's rules don't allow.
 * Not `bypassPermissions`: postings are untrusted text, and the approval cards are what stands between a prompt
 * injected into one and a command run on the user's machine; Claude Code also refuses to switch to it in a session
 * not launched for it.
 */
export const AgentPermissionMode = z.enum(["default", "acceptEdits", "auto", "plan", "dontAsk"]);
export type AgentPermissionMode = z.infer<typeof AgentPermissionMode>;
/** Claude Code's models: an alias for the latest of a family (`sonnet` is Sonnet 5.5 as of Claude Code 2.1). */
export const AgentModel = z.enum(["fable", "opus", "sonnet", "haiku"]);
export type AgentModel = z.infer<typeof AgentModel>;
/** How hard the agent thinks (Claude Code's and `agy`'s `--effort`). */
export const AgentEffort = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type AgentEffort = z.infer<typeof AgentEffort>;
/**
 * The coding agent behind the panel. Antigravity (its CLI, `agy`) has no permission modes the panel can offer
 * besides Plan only and Don't ask (its calls run without approval), and its own models.
 */
export const AgentKind = z.enum(["claude", "antigravity"]);
export type AgentKind = z.infer<typeof AgentKind>;
/** Antigravity's modes: headless, nobody can approve a call, so it runs every call unasked, or only plans. */
export const ANTIGRAVITY_PERMISSION_MODES: AgentPermissionMode[] = ["dontAsk", "plan"];
/**
 * What one agent runs with. `model` is one of `AgentModel` for Claude Code, and one `agy models` lists for
 * Antigravity; none is the agent's own default.
 */
export const AgentChoice = z.object({
  permissionMode: AgentPermissionMode,
  model: z.string().min(1).max(200).optional(),
  effort: AgentEffort,
});
export type AgentChoice = z.infer<typeof AgentChoice>;
export const DEFAULT_AGENT_CHOICES: Record<AgentKind, AgentChoice> = {
  claude: { permissionMode: "auto", model: "sonnet", effort: "medium" },
  antigravity: { permissionMode: "dontAsk", effort: "medium" },
};
/**
 * The agent settings the user chose in the panel: the agent, and each agent's own mode, model and effort, so
 * switching back to one brings back what it ran with. The extension keeps them (`chrome.storage.local`) and gives
 * them to the companion on connecting and on every change (`panel.settings`).
 */
export const AgentPrefs = z.object({
  agent: AgentKind,
  choices: z.object({ claude: AgentChoice.optional(), antigravity: AgentChoice.optional() }),
});
export type AgentPrefs = z.infer<typeof AgentPrefs>;
export const DEFAULT_AGENT_PREFS: AgentPrefs = { agent: "claude", choices: {} };
/** What a conversation runs with: the agent in use and its choice (`effectiveSettings`). */
export const AgentSettings = AgentChoice.extend({ agent: AgentKind });
export type AgentSettings = z.infer<typeof AgentSettings>;

/**
 * Prefs read from storage, each field on its own: one missing or no longer offered (an older build's) falls back to
 * its default alone.
 */
export function readAgentPrefs(raw: unknown): AgentPrefs {
  const o = obj(raw);
  const choices = obj(o.choices);
  const prefs: AgentPrefs = { agent: AgentKind.catch(DEFAULT_AGENT_PREFS.agent).parse(o.agent), choices: {} };
  for (const k of AgentKind.options) {
    const c = obj(choices[k]);
    if (!choices[k]) continue;
    const d = DEFAULT_AGENT_CHOICES[k];
    const model = AgentChoice.shape.model.safeParse(c.model);
    prefs.choices[k] = {
      permissionMode: AgentPermissionMode.catch(d.permissionMode).parse(c.permissionMode),
      ...(model.success && model.data ? { model: model.data } : d.model ? { model: d.model } : {}),
      effort: AgentEffort.catch(d.effort).parse(c.effort),
    };
  }
  return prefs;
}

/**
 * The settings conversations run with: the chosen agent when it's installed (else the first that is), with its own
 * choice, or the defaults for one never chosen. A choice the agent can't take falls back: a Claude model that isn't
 * an alias, an Antigravity mode it doesn't offer.
 */
export function effectiveSettings(prefs: AgentPrefs, installed: readonly AgentKind[]): AgentSettings {
  const agent = installed.includes(prefs.agent) ? prefs.agent : (installed[0] ?? prefs.agent);
  const d = DEFAULT_AGENT_CHOICES[agent];
  const c = prefs.choices[agent] ?? d;
  if (agent === "claude") {
    return {
      agent,
      permissionMode: c.permissionMode,
      model: AgentModel.catch("sonnet").parse(c.model),
      effort: c.effort,
    };
  }
  return {
    agent,
    permissionMode: ANTIGRAVITY_PERMISSION_MODES.includes(c.permissionMode) ? c.permissionMode : d.permissionMode,
    ...(c.model ? { model: c.model } : {}),
    effort: c.effort,
  };
}

/** The prefs with a change to the agent in use (`effectiveSettings`), or the agent chosen. */
export function changeAgentPrefs(
  prefs: AgentPrefs,
  installed: readonly AgentKind[],
  change: Partial<AgentSettings>,
): AgentPrefs {
  const { agent: next, ...rest } = change;
  if (next) return { ...prefs, agent: next };
  const current = effectiveSettings(prefs, installed);
  const { agent, ...choice } = current;
  return { agent, choices: { ...prefs.choices, [agent]: { ...choice, ...rest } } };
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// ---- the panel's methods over the bridge (the extension relays them from its side panel) ----

export const PanelPosting = z.object({
  id: z.string(),
  company: z.string().optional(),
  role: z.string().optional(),
  site: SiteId,
  status: PostingStatus,
  deadline: z.string().optional(),
  url: z.string(),
});
export type PanelPosting = z.infer<typeof PanelPosting>;

export const PanelState = z.object({
  agent: z.object({
    /** Working while any conversation is. */
    status: AgentStatus,
    /** Each conversation with a process running, side by side; `queued`: messages it hasn't taken yet. */
    conversations: z.array(z.object({ conversation: z.string(), status: AgentStatus, queued: z.number() })),
    /** The agents installed, which the panel offers. */
    agents: z.array(AgentKind),
    /** Antigravity's models (`agy models`), once listed; Claude Code's are `AgentModel`. */
    models: z.object({ antigravity: z.array(z.object({ id: z.string(), label: z.string() })).optional() }),
  }),
  /** The newest postings, and any older one a card waits on or an agent is in: the panel's list. */
  postings: z.array(PanelPosting),
  cards: z.array(Card),
  /** Setup: whether the required steps are done, and the ones left. */
  setup: z.object({ ready: z.boolean(), left: z.array(z.string()) }),
});
export type PanelState = z.infer<typeof PanelState>;

export const DocumentState = z.enum(["draft", "review", "approved", "changes", "attached"]);
export type DocumentState = z.infer<typeof DocumentState>;

export const PanelConversation = z.object({
  key: z.string(),
  posting: PanelPosting.extend({
    /** The posting's application requirements (notes.md), a few short lines. */
    requirements: z.array(z.string()),
    /** The application's address, when the posting knows it. */
    application: z.string().optional(),
  }).optional(),
  documents: z.array(z.object({ file: z.string(), state: DocumentState })),
  /** A review waiting on the user, in its own tab. */
  review: z.object({ reviewId: z.string(), files: z.array(z.string()) }).optional(),
  events: z.array(AgentEvent),
  totalCostUsd: z.number().optional(),
});
export type PanelConversation = z.infer<typeof PanelConversation>;

export const PanelTabParams = z.object({
  tabId: z.number().int(),
  url: z.string(),
  title: z.string(),
  site: SiteId,
  /** Its frames on a form site (a careers page embedding Greenhouse); absent from an older extension. */
  frames: z.array(FrameInfo).optional(),
  /** The posting the panel shows, which the tab is told against. */
  postingId: z.string().optional(),
});
export const PanelTab = z.object({
  kind: z.enum(["application", "other-application", "unconfirmed-application", "posting", "page", "none"]),
  text: z.string(),
});
export type PanelTab = z.infer<typeof PanelTab>;

const Empty = z.object({});
/** Methods the companion serves for the panel (`CompanionApi`). */
export const PanelMethods = {
  /** How many panels are open (sent on every change and on connecting): cards are shown while one is. */
  "panel.watch": { params: z.object({ open: z.number().int().min(0) }), result: Empty },
  "panel.state": { params: Empty, result: PanelState },
  "panel.conversation": { params: z.object({ key: z.string() }), result: PanelConversation },
  "panel.tab": { params: PanelTabParams, result: PanelTab },
  "panel.send": {
    params: z.object({ key: z.string(), text: z.string().max(20_000) }),
    result: z.object({ id: z.string() }),
  },
  /** Stop a conversation's turn; the others go on. */
  "panel.stop": { params: z.object({ key: z.string() }), result: z.object({ stopped: z.boolean() }) },
  "panel.reset": { params: z.object({ key: z.string() }), result: Empty },
  /**
   * The agent settings the extension keeps, sent on connecting and on every change: the companion holds them in
   * memory and applies them to a running conversation (Claude Code's mode and model at once, the rest from its next
   * message). Returns what conversations now run with.
   */
  "panel.settings": { params: AgentPrefs, result: AgentSettings },
  "panel.answer": { params: z.object({ cardId: z.string(), answers: AskAnswers }), result: Empty },
  "panel.reply": { params: z.object({ cardId: z.string(), message: z.string().min(1).max(20_000) }), result: Empty },
  "panel.permission": {
    params: z.object({ cardId: z.string(), allow: z.boolean(), reason: z.string().max(2000).optional() }),
    result: Empty,
  },
  /** Delete a posting for good: its folder and its conversation. Refused while it has a review open. */
  "panel.deletePosting": { params: z.object({ postingId: z.string() }), result: Empty },
  /** Delete one of a posting's PDFs for good (its LaTeX source stays). Refused while it's in an open review. */
  "panel.deleteDocument": { params: z.object({ postingId: z.string(), file: z.string() }), result: Empty },
  /** Open, for the user: a review's tab again, a posting's file, or the setup page. */
  "panel.open": {
    params: z.discriminatedUnion("what", [
      z.object({ what: z.literal("review"), reviewId: z.string() }),
      z.object({ what: z.literal("file"), postingId: z.string(), file: z.string() }),
      z.object({ what: z.literal("setup") }),
    ]),
    result: Empty,
  },
};

/** What the companion pushes to the panel (`ExtensionApi`): an agent event, or that its state changed. */
export const PanelUpdate = z.object({
  event: z.object({ conversation: z.string(), event: AgentEvent }).optional(),
  changed: z.boolean().optional(),
  /** How many cards wait on the user: sent even while no panel is open, for the toolbar badge. */
  cards: z.number().int().min(0).optional(),
  /**
   * A system notification: a turn ended (shown if no panel is in view), or a card waits on the user (`card`, shown
   * even then: the user may be watching the form, not the panel). Sent even while no panel is open, and only with
   * the workspace's `notifications.turnEnd` on. Says what's needed, never the posting's details.
   */
  notify: z
    .object({ conversation: z.string(), title: z.string(), message: z.string(), card: z.boolean().optional() })
    .optional(),
});
export type PanelUpdate = z.infer<typeof PanelUpdate>;

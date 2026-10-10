import { z } from "zod";

/**
 * The extension's side panel and the agent behind it: the companion runs Claude Code headless and relays what it
 * does to the panel as events, and what it asks (questions, approvals) as cards the user answers there.
 */

/** A conversation: one per posting (its id), and `general` for work with no posting. */
export const GENERAL_CONVERSATION = "general";

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
    const values = Array.isArray(a.value) ? a.value : [a.value];
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
  /** A message the user sent; `taken` once Claude has it (it may wait for a running tool call). */
  z.object({ kind: z.literal("user"), at, id: z.string(), text: z.string(), taken: z.boolean().optional() }),
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

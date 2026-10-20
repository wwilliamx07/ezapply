import { randomUUID } from "node:crypto";
import {
  type AskAnswers,
  type AskCard,
  type AskSpec,
  askAnswerProblems,
  type Card,
  ErrorCode,
  EzError,
  type PermissionCard,
} from "@ezapply/protocol";

/** How an ask ended: answered, or the user wrote in the chat instead. */
export type AskOutcome = { answers: AskAnswers } | { replied: string };

/** The permission prompt tool's answer, as Claude Code reads it. */
export type PermissionDecision = { behavior: "allow"; updatedInput: unknown } | { behavior: "deny"; message: string };

export interface CardRecord {
  card: Card;
  /** A line for the conversation's record once it's settled. */
  title: string;
}

interface OpenAsk {
  card: AskCard;
  outcome?: AskOutcome;
  waiters: Set<(o: AskOutcome) => void>;
}

interface OpenPermission {
  card: PermissionCard;
  decide: (d: PermissionDecision) => void;
}

/** No answer to a permission prompt in this long is a deny: the agent can't wait on a user who has gone. */
export const PERMISSION_TIMEOUT_MS = 10 * 60_000;

/**
 * What waits on the user: the agent's questions (`ask_user`) and its requests for approval (`permission_ask`),
 * shown as cards in the panel. An ask stays until it's answered, replied to in the chat or withdrawn, and an
 * answer given while nothing waits is kept for the next wait (as a review's is). A permission request is answered
 * once, or denied when nobody answers in time.
 */
export class NeedsYou {
  private readonly asks = new Map<string, OpenAsk>();
  private readonly permissions = new Map<string, OpenPermission>();
  private readonly listeners = new Set<() => void>();
  private readonly settledListeners = new Set<(record: CardRecord, outcome: string) => void>();

  private viewers = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Whether a panel is open to show cards (a terminal chat's questions get one only then). */
  get watched(): boolean {
    return this.viewers > 0;
  }

  /** A panel showing the cards; call the returned function when it closes. */
  watch(): () => void {
    this.viewers++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.viewers--;
    };
  }

  /** An ask's questions, while it's known. */
  spec(id: string): AskSpec | undefined {
    return this.asks.get(id)?.card.spec;
  }

  /** The newest open card of a conversation: what a message typed into it answers. */
  newestOpen(conversation: string): Card | undefined {
    return this.list()
      .filter((c) => c.conversation === conversation)
      .at(-1);
  }

  /** The open cards, oldest first. */
  list(): Card[] {
    const open = [
      ...[...this.asks.values()].filter((a) => !a.outcome).map((a) => a.card as Card),
      ...[...this.permissions.values()].map((p) => p.card as Card),
    ];
    return open.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Called when a card is answered, replied to, decided or withdrawn, with a word on how. */
  onSettled(fn: (record: CardRecord, outcome: string) => void): () => void {
    this.settledListeners.add(fn);
    return () => this.settledListeners.delete(fn);
  }

  /** Open an ask. The spec is checked by the caller (`askSpecProblems`). */
  ask(spec: AskSpec, conversation?: string): AskCard {
    const card: AskCard = {
      id: `ask-${randomUUID().slice(0, 8)}`,
      kind: "ask",
      ...(conversation ? { conversation } : {}),
      createdAt: this.now().toISOString(),
      spec,
    };
    this.asks.set(card.id, { card, waiters: new Set() });
    this.changed();
    return card;
  }

  /** The ask's outcome, waiting up to `timeoutMs` for it; null when it's still open then. */
  async waitAsk(id: string, timeoutMs: number): Promise<AskOutcome | null> {
    const a = this.asks.get(id);
    if (!a)
      throw new EzError(
        ErrorCode.NotFound,
        `No question card ${id}`,
        "It was withdrawn (the conversation was reset) or already read: ask again if you still need the answer.",
      );
    if (a.outcome) return this.take(id, a.outcome);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        a.waiters.delete(done);
        resolve(null);
      }, timeoutMs);
      const done = (o: AskOutcome) => {
        clearTimeout(timer);
        resolve(this.take(id, o));
      };
      a.waiters.add(done);
    });
  }

  /**
   * The ask's outcome whenever it comes, read once (a panel conversation's ask, delivered as a message). Never
   * settles for an ask withdrawn first.
   */
  settledAsk(id: string): Promise<AskOutcome> {
    const a = this.asks.get(id);
    if (!a) return Promise.reject(new EzError(ErrorCode.NotFound, `No question card ${id}`));
    if (a.outcome) return Promise.resolve(this.take(id, a.outcome));
    return new Promise((resolve) => {
      a.waiters.add((o) => resolve(this.take(id, o)));
    });
  }

  /** Whether an ask is open: shown and not answered yet. */
  isOpen(id: string): boolean {
    const a = this.asks.get(id);
    return a !== undefined && !a.outcome;
  }

  /** The user's answers. Checked against the spec; the problems come back as one `bad_request`. */
  answer(id: string, answers: AskAnswers): void {
    const a = this.openAsk(id);
    const problems = askAnswerProblems(a.card.spec, answers);
    if (problems.length > 0) throw new EzError(ErrorCode.BadRequest, problems.join("; "));
    this.settleAsk(a, { answers }, "answered");
  }

  /** The user dismissed the card and wrote in the chat instead. */
  reply(id: string, message: string): void {
    this.settleAsk(this.openAsk(id), { replied: message }, "replied in the chat");
  }

  /** A permission request; resolves with the user's decision, or a deny after `timeoutMs`. */
  permission(
    req: { toolName: string; input: unknown; description?: string },
    conversation?: string,
    timeoutMs = PERMISSION_TIMEOUT_MS,
  ): Promise<PermissionDecision> {
    const card: PermissionCard = {
      id: `perm-${randomUUID().slice(0, 8)}`,
      kind: "permission",
      ...(conversation ? { conversation } : {}),
      createdAt: this.now().toISOString(),
      toolName: req.toolName,
      input: req.input,
      ...(req.description ? { description: req.description } : {}),
    };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        settle(
          { behavior: "deny", message: "Nobody answered in the panel within 10 minutes, so it wasn't run." },
          "timed out",
        );
      }, timeoutMs);
      const settle = (d: PermissionDecision, how: string) => {
        if (!this.permissions.has(card.id)) return;
        clearTimeout(timer);
        this.permissions.delete(card.id);
        this.changed();
        this.settled({ card, title: permissionTitle(card) }, how);
        resolve(d);
      };
      this.permissions.set(card.id, {
        card,
        decide: (d) => settle(d, d.behavior === "allow" ? "allowed" : "denied"),
      });
      this.changed();
    });
  }

  /** The user's decision on a permission card. A deny's reason reaches Claude as the deny message. */
  decide(id: string, allow: boolean, reason?: string): void {
    const p = this.permissions.get(id);
    if (!p) throw new EzError(ErrorCode.NotFound, `No open approval ${id}`, "It was answered, timed out or withdrawn.");
    const message = reason?.trim()
      ? `The user denied this in the ezapply panel: ${reason.trim()}`
      : "The user denied this in the ezapply panel.";
    p.decide(allow ? { behavior: "allow", updatedInput: p.card.input } : { behavior: "deny", message });
  }

  /** Withdraw a conversation's open cards (Reset): its asks end unanswered, its approvals are denied. */
  withdraw(conversation: string): void {
    for (const a of [...this.asks.values()]) {
      if (a.card.conversation !== conversation || a.outcome) continue;
      this.asks.delete(a.card.id);
      this.settled({ card: a.card, title: a.card.spec.title }, "withdrawn");
    }
    for (const p of [...this.permissions.values()]) {
      if (p.card.conversation === conversation) p.decide({ behavior: "deny", message: "The conversation was reset." });
    }
    this.changed();
  }

  private openAsk(id: string): OpenAsk {
    const a = this.asks.get(id);
    if (!a || a.outcome)
      throw new EzError(ErrorCode.NotFound, `No open question card ${id}`, "It was answered or withdrawn.");
    return a;
  }

  private settleAsk(a: OpenAsk, outcome: AskOutcome, how: string): void {
    a.outcome = outcome;
    this.changed();
    this.settled({ card: a.card, title: a.card.spec.title }, how);
    for (const w of [...a.waiters]) w(outcome);
  }

  /** An outcome is read once; the card is gone after. */
  private take(id: string, o: AskOutcome): AskOutcome {
    this.asks.delete(id);
    return o;
  }

  private changed(): void {
    for (const fn of [...this.listeners]) fn();
  }

  private settled(record: CardRecord, how: string): void {
    for (const fn of [...this.settledListeners]) fn(record, how);
  }
}

function permissionTitle(card: PermissionCard): string {
  const input = card.input as Record<string, unknown> | null;
  const what =
    typeof input?.command === "string" ? input.command : typeof input?.file_path === "string" ? input.file_path : "";
  return what ? `${card.toolName}: ${what.length > 80 ? `${what.slice(0, 79)}…` : what}` : card.toolName;
}

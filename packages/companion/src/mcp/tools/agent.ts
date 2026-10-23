import { AskQuestion, type AskSpec, askSpecProblems, ErrorCode, EzError, postingConversation } from "@ezapply/protocol";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Services } from "../../services.js";
import { ok, PENDING_HINT, rawTool, tool } from "../result.js";

/**
 * The panel's side of the agent: its questions (`ask_user`) and the permission prompt Claude Code asks instead of a
 * terminal dialog (`permission_ask`, named by `--permission-prompt-tool`). `session` is the Claude Code session the
 * request came from (the relay's header): a panel conversation's, or a terminal chat's.
 */
export function registerAgentTools(server: McpServer, s: Services, session?: string): void {
  server.registerTool(
    "ask_user",
    {
      title: "Ask the user",
      description:
        "Ask the user questions on a card in the ezapply panel and wait for the answers (default up to 10 minutes). " +
        "Put all of one step's questions in one call. Each question: id, prompt, type single | multi | text; options " +
        "for single and multi (allowOther adds a free-text Other); proposed fills in your suggestion (any question, " +
        "sensitive ones too) with why saying where it came from; sensitive flags it; required: false lets it be " +
        "skipped; remember { answerId, question? } offers saving the answer to the answer bank (question: the form's wording). Returns { done: true, answers: " +
        "{ <id>: { value, other?, remember? } | { skipped } } }, { replied, message } when the user wrote in the " +
        "chat instead, { done: false, askId } when nothing came yet (call ask_user { askId } to keep waiting), or " +
        "{ noPanel } when no panel is open (ask in chat instead). In the panel it returns { pending } at once: end " +
        "your turn, and the result above comes as your next message.",
      inputSchema: {
        title: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("The card's title, e.g. 'Acme, step 3: Application questions'."),
        intro: z.string().max(2000).optional(),
        questions: z.array(AskQuestion).min(1).max(25).optional(),
        askId: z.string().optional().describe("Keep waiting for this earlier ask instead of asking again."),
        timeoutSeconds: z.number().int().min(5).max(900).default(600),
      },
    },
    tool(
      s.log,
      "ask_user",
      async (args: {
        title?: string;
        intro?: string;
        questions?: AskSpec["questions"];
        askId?: string;
        timeoutSeconds: number;
      }) => {
        const timeoutMs = args.timeoutSeconds * 1000;
        const conversation = session ? await s.agent.conversationOf(session) : undefined;
        if (args.askId) {
          // A panel conversation's answer is on its way as a message.
          if (conversation && s.needs.isOpen(args.askId)) return pending(args.askId);
          const spec = s.needs.spec(args.askId);
          return outcome(s, args.askId, await s.needs.waitAsk(args.askId, timeoutMs), spec, conversation, session);
        }
        if (!args.title || !args.questions) {
          throw new EzError(
            ErrorCode.BadRequest,
            "Give title and questions, or askId to keep waiting for an earlier ask.",
          );
        }
        const spec: AskSpec = {
          title: args.title,
          ...(args.intro ? { intro: args.intro } : {}),
          questions: args.questions,
        };
        const problems = askSpecProblems(spec);
        if (problems.length > 0)
          throw new EzError(ErrorCode.BadRequest, problems.join("; "), "Fix those questions and ask again.");
        // A panel conversation's question always gets a card (the panel shows it when opened, with a badge until
        // then); a terminal chat's only when a panel is open to show it.
        if (!conversation && !s.needs.watched) {
          return { noPanel: true, hint: "No ezapply panel is open. Ask the user these questions in chat instead." };
        }
        const card = s.needs.ask(spec, conversation);
        // In a panel conversation the call doesn't wait: the answers start the next turn. A terminal chat's waits.
        if (conversation) {
          s.agent.deliverLater(
            conversation,
            { tool: "ask_user", id: card.id },
            s.needs.settledAsk(card.id).then(async (o) => ({
              value: await outcome(s, card.id, o, spec, conversation, session),
              label: "replied" in o ? `Your reply to ${spec.title}` : `Answers to ${spec.title}`,
            })),
          );
          return pending(card.id);
        }
        return outcome(s, card.id, await s.needs.waitAsk(card.id, timeoutMs), spec, conversation, session);
      },
    ),
  );

  server.registerTool(
    "permission_ask",
    {
      title: "Ask the user to approve a tool call",
      description:
        "Claude Code's permission prompt for the ezapply panel (run with --permission-prompt-tool). Not for calling " +
        "yourself.",
      inputSchema: {
        tool_name: z.string(),
        input: z.unknown(),
        tool_use_id: z.string().optional(),
      },
    },
    // The answer is Claude Code's permission result as JSON text, never an ezapply error: anything that goes wrong
    // is a deny with its reason.
    rawTool(s.log, "permission_ask", async (args: { tool_name: string; input: unknown; tool_use_id?: string }) => {
      const conversation = session ? await s.agent.conversationOf(session) : undefined;
      if (!conversation && !s.needs.watched) {
        return ok({ behavior: "deny", message: "No ezapply panel is open to approve this." });
      }
      const input = args.input ?? {};
      const description =
        typeof (input as { description?: unknown }).description === "string"
          ? (input as { description: string }).description
          : undefined;
      try {
        return ok(
          await s.needs.permission(
            { toolName: args.tool_name, input, ...(description ? { description } : {}) },
            conversation,
          ),
        );
      } catch (err) {
        return ok({ behavior: "deny", message: `The approval failed: ${(err as Error).message}` });
      }
    }),
  );
}

function pending(askId: string): object {
  return { pending: askId, hint: PENDING_HINT };
}

async function outcome(
  s: Services,
  askId: string,
  o: Awaited<ReturnType<Services["needs"]["waitAsk"]>>,
  spec: AskSpec | undefined,
  conversation: string | undefined,
  session: string | undefined,
): Promise<object> {
  if (!o) return { done: false, askId, hint: "Not answered yet: call ask_user { askId } to keep waiting." };
  if ("replied" in o) {
    return {
      replied: true,
      message: o.replied,
      hint: "The user answered in the chat instead of the card: act on their message.",
    };
  }
  // Answers for answer-bank entries: a sensitive one may be filled now that the user gave it, and "Save for next
  // time" is written here, a new entry included.
  const postingId = await postingOf(s, conversation, session);
  const toSave: { answerId: string; question: string; value: string }[] = [];
  for (const q of spec?.questions ?? []) {
    const a = o.answers[q.id];
    if (!q.remember || !a || !("value" in a)) continue;
    if (postingId) s.forms.userAnswered(postingId, q.remember.answerId);
    if (a.remember) {
      const value = Array.isArray(a.value) ? a.value.join(", ") : a.value;
      toSave.push({ answerId: q.remember.answerId, question: q.remember.question ?? q.prompt, value });
    }
  }
  const r = toSave.length ? await s.profile.rememberAnswers(toSave).catch(() => null) : null;
  const saved = r?.ok ? r.set : [];
  const notSaved = toSave.filter((t) => !saved.includes(t.answerId) && !saved.includes(t.answerId.toLowerCase()));
  return {
    done: true,
    answers: o.answers,
    ...(saved.length ? { savedToAnswerBank: saved } : {}),
    ...(notSaved.length ? { notSaved: notSaved.map((t) => t.answerId) } : {}),
  };
}

/** The posting a card's answers are for: its panel conversation's, or the terminal chat's active one. */
async function postingOf(s: Services, conversation: string | undefined, session: string | undefined) {
  if (conversation) return postingConversation(conversation)?.postingId;
  return s.postings.resolve(undefined, session).catch(() => undefined);
}

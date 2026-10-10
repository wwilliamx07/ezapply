import { AskQuestion, type AskSpec, askSpecProblems, ErrorCode, EzError } from "@ezapply/protocol";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Services } from "../../services.js";
import { ok, rawTool, tool } from "../result.js";

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
        "skipped; remember { answerId } offers saving the answer to the answer bank. Returns { done: true, answers: " +
        "{ <id>: { value, other?, remember? } | { skipped } } }, { replied, message } when the user wrote in the " +
        "chat instead, { done: false, askId } when nothing came yet (call ask_user { askId } to keep waiting), or " +
        "{ noPanel } when no panel is open (ask in chat instead).",
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
        if (args.askId) {
          const spec = s.needs.spec(args.askId);
          return outcome(s, args.askId, await s.needs.waitAsk(args.askId, timeoutMs), spec);
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
        const conversation = session ? await s.agent.conversationOf(session) : undefined;
        // A panel conversation's question always gets a card (the panel shows it when opened, with a badge until
        // then); a terminal chat's only when a panel is open to show it.
        if (!conversation && !s.needs.watched) {
          return { noPanel: true, hint: "No ezapply panel is open. Ask the user these questions in chat instead." };
        }
        const card = s.needs.ask(spec, conversation);
        return outcome(s, card.id, await s.needs.waitAsk(card.id, timeoutMs), spec);
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

async function outcome(
  s: Services,
  askId: string,
  o: Awaited<ReturnType<Services["needs"]["waitAsk"]>>,
  spec?: AskSpec,
): Promise<object> {
  if (!o) return { done: false, askId, hint: "Not answered yet: call ask_user { askId } to keep waiting." };
  if ("replied" in o) {
    return {
      replied: true,
      message: o.replied,
      hint: "The user answered in the chat instead of the card: act on their message.",
    };
  }
  // "Save for next time" on an answer bank entry is written here; one the bank doesn't have yet is the agent's to
  // add, as the ezapply-answers skill does.
  const toSave: { questionId: string; answerId: string; value: string | string[] }[] = [];
  for (const q of spec?.questions ?? []) {
    const a = o.answers[q.id];
    if (q.remember && a && "value" in a && a.remember)
      toSave.push({ questionId: q.id, answerId: q.remember.answerId, value: a.value });
  }
  let saved: string[] = [];
  if (toSave.length > 0) {
    const r = await s.profile
      .saveAnswers(
        Object.fromEntries(toSave.map((t) => [t.answerId, Array.isArray(t.value) ? t.value.join(", ") : t.value])),
      )
      .catch(() => null);
    saved = r?.ok ? r.set : [];
  }
  const notSaved = toSave.filter((t) => !saved.includes(t.answerId));
  return {
    done: true,
    answers: o.answers,
    ...(saved.length ? { savedToAnswerBank: saved } : {}),
    ...(notSaved.length
      ? {
          toSave: notSaved,
          hint: "The user asked to save these, and the answer bank has no entry for them yet: add them to profile/answers.yaml.",
        }
      : {}),
  };
}

import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { EzError, postingConversation } from "@ezapply/protocol";
import type { Services } from "../services.js";
import type { DocumentReason } from "./review.js";

/**
 * Open a review for a panel conversation: the page in the user's browser, and how it ends delivered to the
 * conversation as its next message (`AgentService.deliverLater`). `review_documents` calls it, and so does the end of
 * a tailoring turn (`reviewAtTurnEnd`).
 */
export async function openReviewFor(
  s: Services,
  conversation: string,
  files: string[],
  reasons: { short?: DocumentReason[]; again?: DocumentReason[] } = {},
) {
  const review = await s.reviews.open(files, reasons, s.agent.agentName(conversation));
  const openedIn = await s.opener.url(review.url).catch(() => null);
  s.agent.deliverLater(
    conversation,
    { tool: "review_documents", id: review.reviewId },
    // A review replaced by a newer one is the agent's own doing: nothing to tell it.
    s.reviews
      .settled(review.reviewId)
      .then((end) =>
        "supersededBy" in end
          ? null
          : { value: { reviewId: review.reviewId, ...end }, label: end.done ? "Your review" : "The review expiring" },
      ),
  );
  return {
    ...review,
    ...(openedIn
      ? { openedIn }
      : {
          openedBrowser: false,
          tell: `Ask the user to open ${review.url} to approve the documents or write what should change.`,
        }),
  };
}

/** Refusals already sent, by posting and the bytes refused, so a turn that changes nothing isn't told twice. */
const refused = new Map<string, string>();

/**
 * At the end of a posting's tailoring turn, in the after-approval attach mode, the posting's PDFs that are new since
 * the last review go to review, unless something already waits on the user (a card or a review of this posting). The
 * skills told the agent to review each finished document, and live runs ended turns without it; this is the step it
 * can't skip.
 *
 * A PDF older than its `.tex` isn't shown: its last build failed, so it isn't what the agent last wrote. A refusal
 * (an underfilled resume or letter) goes to the conversation as the tool's result would, once for the same bytes,
 * so the agent adds the evidence or passes `short` with its reason. Returns whether a review opened.
 */
export async function reviewAtTurnEnd(s: Services, conversation: string): Promise<boolean> {
  const c = postingConversation(conversation);
  if (c?.part !== "tailor") return false;
  if ((await s.reviews.attachMode()) !== "after-approval") return false;
  if (s.reviews.openFor(c.postingId)) return false;
  if (s.needs.list().some((card) => card.conversation === conversation)) return false;
  const details = await s.postings.details(c.postingId).catch(() => null);
  if (!details) return false;
  const pdfs = details.files
    .map((f) => f.path)
    .filter((p) => p.toLowerCase().endsWith(".pdf") && !p.includes("/") && !/-diff\.pdf$/i.test(p));
  const states = await s.reviews.documentStates(c.postingId, pdfs);
  const files: string[] = [];
  for (const name of pdfs) {
    if (states[name] !== "draft") continue;
    const pdf = s.workspace.path("postings", c.postingId, name);
    const tex = await stat(`${pdf.slice(0, -extname(pdf).length)}.tex`).catch(() => null);
    const built = await stat(pdf).catch(() => null);
    if (tex && built && tex.mtimeMs > built.mtimeMs) continue;
    files.push(`postings/${c.postingId}/${name}`);
  }
  if (files.length === 0) return false;
  try {
    await openReviewFor(s, conversation, files);
    refused.delete(c.postingId);
    return true;
  } catch (err) {
    const e = EzError.from(err);
    const key = `${files.join("|")}:${e.message}`;
    if (refused.get(c.postingId) === key) return false;
    refused.set(c.postingId, key);
    s.log.info({ posting: c.postingId, files: files.map((f) => basename(f)), err: e.message }, "review refused");
    s.agent.deliverLater(
      conversation,
      { tool: "review_documents", id: "turn-end" },
      Promise.resolve({
        value: {
          refused: e.message,
          ...(e.hint ? { hint: e.hint } : {}),
          files,
          why: "The review opens itself when your turn ends, and it couldn't. Fix this and end your turn again, or call review_documents yourself.",
        },
        label: "The review couldn't open",
      }),
    );
    return false;
  }
}

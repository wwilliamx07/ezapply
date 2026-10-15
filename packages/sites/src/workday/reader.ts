import type { PostingRead } from "../readers.js";
import { WORKDAY_POSTING } from "./registry.js";

/**
 * Workday posting pages, through the hooks shared with the adapter (`registry.ts`): they carry no
 * JSON-LD worth reading, and their titles are only the role.
 */
export function readWorkdayPosting(doc: Document): PostingRead {
  const hook = (id: string) => `[data-automation-id="${id}"]`;
  const text = (sel: string) => doc.querySelector(sel)?.textContent?.trim() || undefined;
  const result: PostingRead = { titleIsRole: true };
  const description = doc.querySelector(hook(WORKDAY_POSTING.description));
  if (description) result.descriptionHtml = description.innerHTML;
  const role = text(hook(WORKDAY_POSTING.header));
  if (role) result.role = role;
  const location = text(`${hook(WORKDAY_POSTING.locations)} dd`) ?? text(hook(WORKDAY_POSTING.locations));
  if (location) result.location = location.replace(/^locations\s*/i, "");
  const reqId = text(`${hook(WORKDAY_POSTING.requisitionId)} dd`) ?? text(hook(WORKDAY_POSTING.requisitionId));
  if (reqId) result.reqId = reqId.replace(/^job requisition id\s*/i, "");
  return result;
}

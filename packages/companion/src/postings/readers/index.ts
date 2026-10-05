import type { FormSiteId } from "@ezapply/protocol";
import { readWorkdayPosting } from "./workday.js";

/** What a site's own reader finds on its posting page, before JSON-LD and the page title are read. */
export interface PostingRead {
  /** The description's HTML, instead of what Readability finds. */
  descriptionHtml?: string;
  role?: string;
  location?: string;
  reqId?: string;
  /** The page title is the role alone, not "Role - Company": don't split it. */
  titleIsRole?: boolean;
}

export type PostingReader = (doc: Document, url: string) => PostingRead;

/**
 * Posting readers of the sites whose posting pages the generic capture reads badly (JSON-LD, then the title, then
 * Readability: `extract.ts`). Most sites need none. A site gets one only when a capture of its posting page came out
 * wrong, and it goes here, never as a branch in `extract.ts`.
 */
export const POSTING_READERS: Partial<Record<FormSiteId, PostingReader>> = {
  workday: readWorkdayPosting,
};

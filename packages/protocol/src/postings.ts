import { z } from "zod";

export const PostingStatus = z.enum(["captured", "drafting", "attached", "filled", "submitted", "archived"]);
export type PostingStatus = z.infer<typeof PostingStatus>;

export const SiteId = z.enum(["workday", "oracle", "greenhouse", "lever", "ashby", "generic"]);
export type SiteId = z.infer<typeof SiteId>;

/** What the extension sends when the user presses "Set posting". */
export const CapturePayload = z.object({
  url: z.string().url(),
  pageTitle: z.string(),
  /** document.body.innerHTML, verbatim. */
  html: z.string(),
  /** body HTML with elements that were not visible to the user removed. */
  visibleHtml: z.string(),
  /** document.body.innerText (rendered, visible text only). */
  visibleText: z.string(),
  /** Contents of every <script type="application/ld+json"> on the page (head included). */
  jsonLd: z.array(z.string()).default([]),
  /** Set when the content came from an embedded frame (a job board on a career page); `url` is the tab's. */
  frameUrl: z.string().url().optional(),
  capturedAt: z.string().datetime(),
  tabId: z.number().int(),
});
export type CapturePayload = z.infer<typeof CapturePayload>;

export const CaptureResult = z.object({
  postingId: z.string(),
  isNew: z.boolean(),
  company: z.string().optional(),
  role: z.string().optional(),
});
export type CaptureResult = z.infer<typeof CaptureResult>;

/** Stored as postings/<id>/meta.json. Bump schemaVersion and add a migration on change. */
export const PostingMeta = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  url: z.string(),
  canonicalUrl: z.string(),
  /** The embedded job board frame the content was captured from, if any. */
  frameUrl: z.string().optional(),
  pageTitle: z.string(),
  site: SiteId,
  tenant: z.string().optional(),
  company: z.string().optional(),
  role: z.string().optional(),
  reqId: z.string().optional(),
  location: z.string().optional(),
  deadline: z.string().optional(),
  bundleRequired: z.boolean().optional(),
  status: PostingStatus,
  tabId: z.number().int().optional(),
  capturedAt: z.string(),
  updatedAt: z.string(),
});
export type PostingMeta = z.infer<typeof PostingMeta>;

/** Fields Claude may set after reading a posting. */
export const PostingMetaPatch = z.object({
  company: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  reqId: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  deadline: z.string().min(1).optional(),
  bundleRequired: z.boolean().optional(),
  status: PostingStatus.optional(),
});
export type PostingMetaPatch = z.infer<typeof PostingMetaPatch>;

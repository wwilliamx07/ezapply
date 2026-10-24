/**
 * What the adapter harness (`scripts/harness/`) needs to know about a site's server to stand in for it: each of its
 * requests by URL pattern and what kind of request it is. A site gets one (`<site>/clone.ts`) once a clone of it has
 * been made: the cloner proposes it from what it recorded, and it is listed here. No zod, no DOM: the harness loads
 * it in Node.
 */
import type { FormSiteId } from "./registry.js";

/**
 * What a request does, which decides how the stand-in answers one it hasn't seen exactly:
 * - `static`, `list`, `nested-list`, `validate`: only as recorded, by the parts in `key` (a list's parent, a page).
 * - `search`: as recorded, else the saved dataset filtered by the typed text with the site's matching rule.
 * - `save`: kept for the session; answered as recorded.
 * - `step`: the recorded way on when every `required` part is present, else the recorded refusal.
 * - `upload`: accepted, whatever the file.
 * - `beacon`: analytics and the like, answered empty and never compared.
 * - `submit`: never answered; seeing one fails the run.
 */
export type EndpointKind =
  | "static"
  | "list"
  | "nested-list"
  | "search"
  | "save"
  | "step"
  | "upload"
  | "validate"
  | "beacon"
  | "submit";

/**
 * A part of a request: `query.<name>`, `body.<dotted path>` (a JSON or form body), `header.<name>` (lowercase),
 * `path.<n>` (the n-th path segment, from 0), or `method`.
 */
export type RequestPart = string;

export interface EndpointSpec {
  /** A short name, unique in the description: the report and the timings use it. */
  name: string;
  kind: EndpointKind;
  /** Only this method; any when absent. */
  method?: string;
  /** Matched against the whole URL. */
  url: RegExp;
  /** The parts that pick a recorded answer. Absent: the method, the URL and the body, all of them. */
  key?: RequestPart[];
  /** `search`: the part holding the typed text. */
  query?: RequestPart;
  /** `search`: how the site matches the text against a label (case-insensitive unless `caseSensitive`). */
  match?: "prefix" | "word" | "contains";
  caseSensitive?: boolean;
  /** `search`: the dotted path to the results in the response's JSON, and to each result's label within it. */
  items?: string;
  label?: string;
  /** `step`: the parts that must be present and non-empty for the step to go on. */
  required?: RequestPart[];
  /** Parts of the response's JSON (dotted paths) that differ between two identical requests: not compared. */
  volatile?: string[];
}

/** A token the site issues in a response and expects back on later requests (a CSRF token). */
interface TokenSpec {
  name: string;
  /** Where it's issued: group 1 of this pattern, in a response body or header. */
  issued: RegExp;
  /** Where requests send it back. */
  sent: RequestPart;
}

export interface CloneDescription {
  /** The site's requests by kind; a request none matches is answered only from the saved front end. */
  endpoints: EndpointSpec[];
  tokens?: TokenSpec[];
  /** Query parameters that only bust caches: ignored when a saved file is looked up. */
  cacheBusters?: string[];
  /** What the explorer may do on this site beyond the defaults. */
  explorer?: {
    /** The page keeps an attached file until Submit, so the explorer may attach a placeholder one. */
    uploads?: boolean;
    /** At most this many answers tried per choice when looking for the sections it opens (default 12). */
    maxAnswers?: number;
  };
}

/** Each cloned site's description. */
export const CLONE_DESCRIPTIONS: Partial<Record<FormSiteId, CloneDescription>> = {};

/**
 * What the companion's pages (the UI package) and the companion say to each other over HTTP. Types only, so the
 * pages import them without bundling anything (`import type`).
 */

/** A rectangle on a page, as fractions of the page's width and height, so it holds at any zoom. */
export interface PageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A comment on a passage of a document under review. */
export interface ReviewComment {
  /** 1-based. */
  page: number;
  /** The words selected. */
  quote: string;
  /** What should change there. */
  note: string;
  /** Where the passage is on the page, to highlight it again. */
  rects?: PageRect[];
}

export type ReviewStatus = "open" | "answered" | "replaced" | "expired";

/** GET <review>/state */
export interface ReviewPageState {
  id: string;
  status: ReviewStatus;
  posting: { id: string; company?: string; role?: string };
  expiresAt: string;
  files: ReviewPageFile[];
  /** What the user sent, once answered. */
  answer?: ReviewAnswer;
}

export interface ReviewPageFile {
  index: number;
  /** Relative to the posting folder. */
  name: string;
  bytes: number;
  /** What the companion read in it; absent when it couldn't read the file as a PDF. */
  info?: { pages: number; pageSize?: string; hasTextLayer: boolean; encrypted: boolean };
  /** The page limit set for resumes, for a file named like one (`resume.pageLimit`). */
  pageLimit?: number;
  /** The version the user last answered a review of, by this name in this posting. */
  previous?: PreviousReview;
}

export interface PreviousReview {
  at: string;
  reviewId: string;
  /** The same bytes as now: nothing changed since. */
  same: boolean;
  /** Approved then. */
  approved: boolean;
  /** Its text per page, to show what changed (`@ezapply/protocol/textdiff`). Absent when it had none. */
  pages?: string[];
}

/** POST <review>/answer: each document's request and comments. One with neither is approved as shown. */
export interface ReviewAnswerBody {
  documents: { index: number; request?: string; comments?: ReviewComment[] }[];
}

/** What review_documents returns, and the answered page shows. */
export interface ReviewAnswer {
  /** Approved as shown (paths relative to the posting folder). */
  approved: string[];
  /** What the user wants changed: their words for the document, and comments on passages. */
  changes: { file: string; request?: string; comments?: ReviewComment[] }[];
}

// ---- onboarding ----------------------------------------------------------------------------------

/** The onboarding page's steps, in order (from `workspace_check`'s items). */
export type OnboardStepId =
  | "tex"
  | "extension"
  | "github"
  | "repos"
  | "knowledge"
  | "resume"
  | "profile"
  | "cover"
  | "answers"
  | "preferences"
  | "library";

/** Work the page hands to the agent: what needs judgment or the agent's shell. */
export type OnboardTaskKind =
  | "install-tex"
  | "index-repos"
  | "fix-template-build"
  | "draft-profile"
  | "fill-cover-identity"
  | "restyle-cover"
  | "cover-from-example"
  | "revise-cover"
  | "question";

export interface OnboardTask {
  id: string;
  kind: OnboardTaskKind;
  params: Record<string, unknown>;
  status: "queued" | "running" | "done" | "failed";
  /** What the agent said when it finished. */
  note?: string;
  createdAt: string;
}

export interface OnboardStep {
  id: OnboardStepId;
  done: boolean;
  required: boolean;
  detail: string;
}

/** GET /onboard/state */
export interface OnboardState {
  status: "open" | "finished";
  /** Every required step done. */
  ready: boolean;
  /** EZAPPLY.md missing or not imported: `ezapply init` fixes it, the page can't. */
  agentFile: { done: boolean; detail: string };
  steps: OnboardStep[];
  tasks: OnboardTask[];
  /** The agent can take a task: the panel's agent is available, or Claude in the terminal waits in `onboarding`. */
  agentListening: boolean;
  /** Where the agent works: the side panel's (`ezapply`), or Claude in a terminal (`ezapply chat`). */
  agentIn: "panel" | "terminal";
  tex: { done: boolean; detail: string; installCommand: string };
  extension: {
    connected: boolean;
    paired: boolean;
    browser?: string;
    pairingOpen: boolean;
    built: boolean;
    chromeFolder?: string;
    firefoxManifest?: string;
  };
  github: { appRegistered: boolean; loggedIn: boolean; login?: string; manageUrl?: string; problem?: string };
  repos: { selected: string[]; indexed: Record<string, string | null> };
  resume: { main?: string; source?: string; pdf?: string };
  cover: { main?: string; isDefault: boolean; example?: string; pdf?: string };
  profile: {
    exists: boolean;
    valid: boolean;
    /** What the file holds now, as plain data, even when it doesn't validate. */
    value?: Record<string, unknown>;
    errors?: { path: string; message: string }[];
    missing?: string[];
  };
  answers: {
    total: number;
    answered: number;
    unanswered: { id: string; canonical: string; suggested?: string; source?: string; sensitive: boolean }[];
  };
  preferences: OnboardPreferences;
  library: string[];
}

export interface OnboardPreferences {
  attachMode: "after-approval" | "immediately";
  tone: string;
  emphasis: string;
  neverMention: string;
  targets: string;
  coverLetters: string;
}

/** A repo the GitHub app can read, as the repos step lists it. */
export interface OnboardRepo {
  fullName: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  language: string | null;
  sizeKb: number;
  pushedAt: string | null;
  description: string | null;
  stars: number;
  selected: boolean;
  /** Preselected when nothing is selected yet: the skill's rules that need no judgment. */
  suggested: boolean;
  /** Why it isn't suggested. */
  skipReason?: string;
}

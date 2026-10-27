import {
  type Card,
  DEFAULT_AGENT_PREFS,
  ONBOARD_STEP_IDS,
  type OnboardRepo,
  type OnboardState,
  type PanelConversation,
  type PanelPosting,
  type PanelState,
  type ReviewPageFile,
  type ReviewPageState,
  type WorkspaceChanges,
} from "@ezapply/protocol";
import { type Fake, OnboardFake, PanelFake, ReviewFake } from "./fakes.ts";
import { makePdf } from "./pdf.ts";

/**
 * The fuzzer's starting states, by name. Written by hand with the protocol's own types, so a change to what the
 * companion sends fails the typecheck here rather than leaving the fuzzer testing a shape the companion no longer
 * has. Placeholder people and employers only: every scenario's screenshots are committed as goldens.
 */
export type Section = "panel" | "review" | "onboarding";

export interface Scenario {
  name: string;
  section: Section;
  /** What state it starts in, for the report. */
  what: string;
  /** The map page it opens on ("panel/list"). */
  start: string;
  make(): Fake;
}

const AT = "2026-01-05T10:00:00.000Z";

// ---- the side panel ----------------------------------------------------------------------------------------------

const ACME: PanelPosting = {
  id: "2026-01-05_acme_software-developer",
  company: "Acme",
  role: "Software Developer",
  site: "workday",
  status: "drafting",
  deadline: "2026-02-01",
  url: "https://example-tenant.myworkdayjobs.com/en-US/careers/job/REQ-0000",
};
const GLOBEX: PanelPosting = {
  id: "2026-01-04_globex_data-analyst",
  company: "Globex",
  role: "Data Analyst",
  site: "greenhouse",
  status: "captured",
  url: "https://job-boards.greenhouse.io/example/jobs/0000",
};
const INITECH: PanelPosting = {
  id: "2026-01-02_initech_backend-engineer",
  company: "Initech",
  role: "Backend Engineer",
  site: "lever",
  status: "submitted",
  url: "https://jobs.lever.co/example/00000000-0000",
};
const key = (p: PanelPosting, part: "tailor" | "fill") => `${p.id}/${part}`;

function panelState(over: Partial<PanelState> = {}): PanelState {
  return {
    agent: { status: "idle", conversations: [], agents: ["claude"], models: {} },
    postings: [ACME, GLOBEX, INITECH],
    cards: [],
    setup: { ready: true, left: [] },
    ...over,
  };
}

/** Acme's documents conversation: a turn with a tool call that worked and one that failed, and its documents. */
const ACME_TAILOR: PanelConversation = {
  key: key(ACME, "tailor"),
  posting: {
    ...ACME,
    requirements: ["Resume as PDF", "Cover letter optional"],
    application: "https://example-tenant.myworkdayjobs.com/en-US/careers/job/REQ-0000/apply",
  },
  documents: [
    { file: "resume.pdf", state: "approved" },
    { file: "cover.pdf", state: "review" },
  ],
  review: { reviewId: "rev-0000", files: ["cover.pdf"] },
  events: [
    { kind: "user", at: AT, id: "u1", text: "Tailor my resume for this posting." },
    {
      kind: "text",
      at: AT,
      text: "I read the posting. It asks for **Python** and *distributed systems*:\n\n- one\n- two",
    },
    { kind: "tool", at: AT, id: "t1", name: "mcp__ezapply__posting_get", summary: "Acme: Software Developer" },
    { kind: "toolDone", at: AT, id: "t1", ok: true },
    { kind: "tool", at: AT, id: "t2", name: "mcp__ezapply__tex_compile", summary: "resume" },
    { kind: "toolDone", at: AT, id: "t2", ok: false, error: "! Undefined control sequence." },
    { kind: "notice", at: AT, level: "warn", text: "The build failed once and was retried." },
    { kind: "turnEnd", at: AT, ok: true, totalCostUsd: 0.42 },
    { kind: "user", at: AT, id: "u2", text: "Your review: sent", delivery: true, taken: true },
  ],
  totalCostUsd: 0.42,
};

const ACME_FILL: PanelConversation = {
  key: key(ACME, "fill"),
  posting: ACME_TAILOR.posting,
  documents: ACME_TAILOR.documents,
  events: [
    { kind: "user", at: AT, id: "u3", text: "Fill out the application." },
    {
      kind: "handoff",
      at: AT,
      attached: ["resume.pdf"],
      notAttached: ["cover.pdf"],
      steps: [{ step: "My Experience", warnings: ["A date was entered as text."] }],
      answersToFlag: [{ fieldId: "salary", label: "Expected salary", value: "Negotiable", source: "agent" }],
      removed: [{ what: "An empty work experience", reason: "it had no title" }],
    },
    { kind: "turnEnd", at: AT, ok: false, error: "The tab was closed." },
  ],
  totalTokens: 12_345,
};

const ASK: Card = {
  id: "c1",
  kind: "ask",
  conversation: key(ACME, "tailor"),
  createdAt: AT,
  spec: {
    title: "A few questions about the resume",
    intro: "Before I tailor it:",
    questions: [
      {
        id: "focus",
        prompt: "Which project leads?",
        type: "single",
        options: [
          { value: "api", label: "The API gateway" },
          { value: "etl", description: "The data pipeline" },
        ],
        allowOther: true,
        proposed: "api",
        why: "It matches the posting best.",
      },
      {
        id: "skills",
        prompt: "Skills to stress",
        type: "multi",
        options: [{ value: "Python" }, { value: "Go" }, { value: "SQL" }],
        required: false,
      },
      {
        id: "salary",
        prompt: "Expected salary",
        type: "text",
        sensitive: true,
        proposed: "Negotiable",
        remember: { answerId: "salary" },
      },
      { id: "note", prompt: "Anything else?", type: "text", multiline: true, required: false, maxLength: 2000 },
    ],
  },
};
const PERMISSION: Card = {
  id: "c2",
  kind: "permission",
  conversation: key(GLOBEX, "tailor"),
  createdAt: AT,
  toolName: "Bash",
  input: { command: "latexmk -xelatex main.tex" },
  description: "Build the cover letter",
};
const TERMINAL_PERMISSION: Card = {
  id: "c3",
  kind: "permission",
  createdAt: AT,
  toolName: "Edit",
  input: { file_path: "profile/profile.yaml", old_string: "city: Springfield", new_string: "city: Shelbyville" },
};

const CHANGES: WorkspaceChanges = {
  changes: [
    { id: "w1", kind: "template-source", summary: "Your resume's source changed.", needed: true },
    { id: "w2", kind: "profile-identity", summary: "Your profile's name or contact changed.", needed: true },
    { id: "w3", kind: "repo-pushed", summary: "example/gateway has new commits.", needed: false },
    { id: "w4", kind: "library-template", summary: "library/letter.tex looks like a template.", needed: false },
    { id: "w5", kind: "template-untracked", summary: "Your cover letter came from a copy.", needed: false },
    { id: "w6", kind: "resume-edited", summary: "You edited your resume.", needed: true },
    { id: "w7", kind: "repo-deselected", summary: "example/old-site isn't selected any more.", needed: false },
    {
      id: "w8",
      kind: "template-source",
      summary: "Being updated.",
      needed: false,
      working: true,
      note: "The last try failed.",
    },
  ],
  deferred: [{ repo: "example/dotfiles", until: "2026-02-01T00:00:00.000Z" }],
  notChecked: [{ what: "GitHub", reason: "the login expired", hint: "Log in again on the setup page." }],
};

const PANEL: Scenario[] = [
  {
    name: "panel-empty",
    section: "panel",
    what: "connected, set up, no applications yet",
    start: "panel/list",
    make: () => new PanelFake({ state: panelState({ postings: [] }) }),
  },
  {
    name: "panel-quiet",
    section: "panel",
    what: "three applications, nothing running, documents and workspace changes, setup not finished",
    start: "panel/list",
    make: () =>
      new PanelFake({
        state: panelState({
          setup: { ready: false, left: ["GitHub", "Your profile"] },
          agent: {
            status: "idle",
            conversations: [],
            agents: ["claude", "codex", "antigravity"],
            models: { codex: [{ id: "gpt-5-codex", label: "GPT-5 Codex" }] },
          },
        }),
        conversations: { [ACME_TAILOR.key]: ACME_TAILOR, [ACME_FILL.key]: ACME_FILL },
        tab: { kind: "application", text: "Acme: Software Developer: the application on Workday", tabId: 7 },
        changes: CHANGES,
      }),
  },
  {
    name: "panel-busy",
    section: "panel",
    what: "agents working in two conversations, a question and two approvals waiting",
    start: "panel/list",
    make: () =>
      new PanelFake({
        state: panelState({
          agent: {
            status: "working",
            conversations: [
              { conversation: key(ACME, "fill"), status: "working", queued: 1 },
              { conversation: key(GLOBEX, "tailor"), status: "starting", queued: 0 },
              { conversation: key(INITECH, "tailor"), status: "working", queued: 0 },
              { conversation: "general", status: "working", queued: 0 },
            ],
            agents: ["claude"],
            models: {},
          },
          cards: [ASK, PERMISSION, TERMINAL_PERMISSION],
        }),
        conversations: { [ACME_TAILOR.key]: ACME_TAILOR, [ACME_FILL.key]: ACME_FILL },
        tab: { kind: "page", text: "A page that isn't this posting's", tabId: 9 },
        capture: { ok: false, error: "This tab has no web page to capture." },
      }),
  },
  {
    name: "panel-offline",
    section: "panel",
    what: "ezapply isn't running",
    start: "panel/list",
    make: () =>
      new PanelFake({ state: panelState(), connection: { state: "disconnected" }, prefs: DEFAULT_AGENT_PREFS }),
  },
  {
    name: "panel-unpaired",
    section: "panel",
    what: "the extension isn't paired",
    start: "panel/list",
    make: () => new PanelFake({ state: panelState(), connection: { state: "unconfigured" } }),
  },
];

// ---- the review page ---------------------------------------------------------------------------------------------

const RESUME_V1 = [
  "Jane Doe",
  "jane@example.com | https://example.com/jane",
  "Experience",
  "Software Developer, Example Corp, 2022 to now",
  "Built the API gateway in Go, serving every request.",
  "Moved the nightly reports to a streaming pipeline.",
];
const RESUME_V2 = [
  "Jane Doe",
  "jane@example.com | https://example.com/jane",
  "Experience",
  "Software Developer, Example Corp, 2022 to now",
  "Built and ran the API gateway in Go, serving every request.",
  "Cut the reports' delay from a day to minutes.",
];
const COVER = [
  "Dear hiring team,",
  "I would like to apply for the Software Developer role at Acme.",
  "My work on the API gateway (and its tests: 100% of the routes) fits what you ask for.",
  "Kind regards,",
  "Jane Doe",
];

function reviewFiles(): { files: ReviewPageFile[]; bytes: Buffer[] } {
  const resume = makePdf([
    {
      lines: RESUME_V2,
      links: [
        { line: 1, url: "mailto:jane@example.com" },
        { line: 0, url: "https://example.com/jane" },
        { line: 2, page: 1 },
      ],
    },
    { lines: ["Education", "B.Sc. Computer Science, Example University, 2021"] },
  ]);
  const cover = makePdf([{ lines: COVER }]);
  return {
    bytes: [resume, cover, Buffer.from("not a pdf")],
    files: [
      {
        index: 0,
        name: "resume.pdf",
        bytes: resume.length,
        info: { pages: 2, pageSize: "letter", hasTextLayer: true, encrypted: false },
        pageLimit: 1,
        previous: {
          at: "2026-01-04T09:00:00.000Z",
          reviewId: "rev-prev",
          same: false,
          approved: false,
          pages: [RESUME_V1.join("\n"), "Education\nB.Sc. Computer Science, Example University, 2021"],
        },
      },
      {
        index: 1,
        name: "cover.pdf",
        bytes: cover.length,
        info: { pages: 1, pageSize: "letter", hasTextLayer: true, encrypted: false },
      },
      { index: 2, name: "transcript.pdf", bytes: 9 },
    ],
  };
}

function reviewState(over: Partial<ReviewPageState> = {}): { state: ReviewPageState; files: Buffer[] } {
  const { files, bytes } = reviewFiles();
  return {
    state: {
      id: "rev-0000",
      status: "open",
      posting: { id: ACME.id, company: "Acme", role: "Software Developer" },
      agentName: "Claude Code",
      expiresAt: "2026-01-06T10:00:00.000Z",
      files,
      ...over,
    },
    files: bytes,
  };
}

const REVIEW: Scenario[] = [
  {
    name: "review-open",
    section: "review",
    what: "a resume changed since the last review, a cover letter, a file that isn't a PDF",
    start: "review/page",
    make: () => new ReviewFake(reviewState()),
  },
  {
    name: "review-answered",
    section: "review",
    what: "a review already answered",
    start: "review/answered",
    make: () =>
      new ReviewFake(
        reviewState({
          status: "answered",
          answer: {
            approved: ["cover.pdf"],
            changes: [
              { file: "resume.pdf", request: "Shorter.", comments: [{ page: 1, quote: "Go", note: "Say Golang" }] },
            ],
          },
        }),
      ),
  },
  {
    name: "review-replaced",
    section: "review",
    what: "a newer review opened",
    start: "review/replaced",
    make: () => new ReviewFake(reviewState({ status: "replaced" })),
  },
  {
    name: "review-expired",
    section: "review",
    what: "a review that expired",
    start: "review/expired",
    make: () => new ReviewFake(reviewState({ status: "expired" })),
  },
];

// ---- the onboarding page -----------------------------------------------------------------------------------------

const STEP_DETAIL: Record<string, string> = { tex: "engine: xelatex (TeX Live 2025)" };

function onboardState(done: readonly string[], over: Partial<OnboardState> = {}): OnboardState {
  const optional = new Set(["cover", "answers", "preferences", "library", "knowledge"]);
  const steps = ONBOARD_STEP_IDS.map((id) => ({
    id,
    done: done.includes(id),
    required: !optional.has(id),
    detail: STEP_DETAIL[id] ?? "",
  }));
  return {
    status: "open",
    ready: steps.every((s) => s.done || !s.required),
    agentFile: { done: true, detail: "EZAPPLY.md is imported." },
    steps,
    tasks: [],
    agentListening: true,
    agentIn: "panel",
    agentName: "Claude Code",
    tex: {
      done: done.includes("tex"),
      detail: STEP_DETAIL.tex ?? "",
      installCommand: "winget install MiKTeX.MiKTeX",
      canInstall: true,
    },
    extension: {
      connected: done.includes("extension"),
      paired: done.includes("extension"),
      ...(done.includes("extension") ? { browser: "chrome" } : {}),
      pairingOpen: false,
      built: true,
      chromeFolder: "/home/jane/ezapply/packages/extension/dist",
    },
    github: done.includes("github")
      ? {
          appRegistered: true,
          loggedIn: true,
          login: "janedoe",
          manageUrl: "https://github.com/settings/installations",
        }
      : { appRegistered: false, loggedIn: false },
    repos: { selected: [], indexed: {} },
    resume: {},
    cover: { isDefault: true },
    profile: { exists: false, valid: false },
    answers: {
      total: 4,
      answered: 1,
      unanswered: [
        {
          id: "authorized",
          canonical: "Are you authorized to work in this country?",
          suggested: "Yes",
          sensitive: false,
        },
        { id: "gender", canonical: "Gender", sensitive: true },
      ],
      fromProfile: [{ id: "email", canonical: "Email", source: "contact.email", value: "jane@example.com" }],
    },
    preferences: {
      attachMode: "after-approval",
      tone: "",
      emphasis: "",
      neverMention: "",
      targets: "",
      coverLetters: "",
    },
    notifications: { turnEnd: false },
    library: [],
    changes: { changes: [] },
    ...over,
  };
}

const REPOS: OnboardRepo[] = [
  {
    fullName: "janedoe/gateway",
    private: false,
    fork: false,
    archived: false,
    language: "Go",
    sizeKb: 2400,
    pushedAt: "2025-12-01T00:00:00.000Z",
    description: "An API gateway",
    stars: 12,
    selected: false,
    suggested: true,
  },
  {
    fullName: "janedoe/pipeline",
    private: true,
    fork: false,
    archived: false,
    language: "Python",
    sizeKb: 800,
    pushedAt: "2025-10-01T00:00:00.000Z",
    description: null,
    stars: 0,
    selected: false,
    suggested: true,
  },
  {
    fullName: "janedoe/dotfiles",
    private: false,
    fork: false,
    archived: false,
    language: "Shell",
    sizeKb: 20,
    pushedAt: null,
    description: "My config",
    stars: 0,
    selected: false,
    suggested: false,
    skipReason: "dotfiles or config",
  },
];

/** The cover letter template's build, with the mail link its contact line has. */
const coverPdf = () => makePdf([{ lines: COVER, links: [{ line: 4, url: "mailto:jane@example.com" }] }]);

const PROFILE = {
  identity: { firstName: "Jane", lastName: "Doe" },
  contact: { email: "jane@example.com", phone: { countryCode: "+1", number: "555-0100", type: "mobile" } },
  work: [{ company: "Example Corp", title: "Software Developer", start: "2022-01" }],
};

const ONBOARDING: Scenario[] = [
  {
    name: "onboard-fresh",
    section: "onboarding",
    what: "nothing set up yet",
    start: "onboarding/tex",
    make: () => new OnboardFake({ state: onboardState([]), pdf: coverPdf() }),
  },
  {
    name: "onboard-most",
    section: "onboarding",
    what: "the required steps done, a repository not read, workspace changes, a build that fails",
    start: "onboarding/tex",
    make: () =>
      new OnboardFake({
        state: onboardState(["tex", "extension", "github", "repos", "resume", "profile"], {
          repos: {
            selected: ["janedoe/gateway", "janedoe/pipeline"],
            indexed: { "janedoe/gateway": "2026-01-03T00:00:00.000Z", "janedoe/pipeline": null },
          },
          resume: {
            main: "templates/resume/main.tex",
            source: "/home/jane/resume",
            pdf: "templates/resume/main.pdf",
            builtAt: AT,
          },
          cover: { isDefault: true, main: "templates/cover/main.tex", pdf: "templates/cover/main.pdf", builtAt: AT },
          profile: { exists: true, valid: true, value: PROFILE, missing: ["contact.address.region (asked often)"] },
          library: ["transcript.pdf", "certificate.png"],
          tasks: [
            { id: "t1", kind: "index-repos", params: {}, status: "done", note: "Read 1 repository.", createdAt: AT },
            { id: "t2", kind: "draft-profile", params: {}, status: "failed", createdAt: AT },
          ],
          changes: { changes: CHANGES.changes.slice(0, 3) },
        }),
        repos: REPOS,
        pdf: coverPdf(),
        build: "fails",
      }),
  },
  {
    name: "onboard-finished",
    section: "onboarding",
    what: "setup finished",
    start: "onboarding/finished",
    make: () =>
      new OnboardFake({ state: onboardState([...ONBOARD_STEP_IDS], { status: "finished" }), pdf: coverPdf() }),
  },
];

export const SCENARIOS: Scenario[] = [...PANEL, ...REVIEW, ...ONBOARDING];

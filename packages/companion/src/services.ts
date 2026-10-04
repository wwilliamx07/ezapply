import type { ExtensionBridge } from "./bridge/server.js";
import type { ReviewService } from "./documents/review.js";
import type { DocumentsService } from "./documents/service.js";
import type { FormsService } from "./forms/service.js";
import type { FreshnessService } from "./freshness/service.js";
import type { GitHubService } from "./github/service.js";
import type { Logger } from "./logger.js";
import type { PostingsService } from "./postings/service.js";
import type { ProfileService } from "./profile/service.js";
import type { RepoService } from "./repos/service.js";
import type { TemplateService } from "./templates/service.js";
import type { Opener } from "./util/open.js";
import type { Workspace } from "./workspace/workspace.js";

/** Everything MCP tools may use. Wired once in main.ts; tools never construct services. */
export interface Services {
  version: string;
  log: Logger;
  workspace: Workspace;
  postings: PostingsService;
  documents: DocumentsService;
  /** Document review in the browser and the attach mode. */
  reviews: ReviewService;
  profile: ProfileService;
  templates: TemplateService;
  github: GitHubService;
  repos: RepoService;
  /** What in the workspace is behind its source (`workspace_changes`). */
  freshness: FreshnessService;
  forms: FormsService;
  bridge: ExtensionBridge;
  /** Opens files and the companion's own pages for the user (a stub in tests). */
  opener: Opener;
  /** The extension package folder (holds dist/ and dist-firefox/), when known. */
  extensionDir?: string;
}

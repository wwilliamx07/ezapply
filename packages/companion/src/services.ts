import type { ExtensionBridge } from "./bridge/server.js";
import type { DocumentsService } from "./documents/service.js";
import type { GitHubService } from "./github/service.js";
import type { Logger } from "./logger.js";
import type { PostingsService } from "./postings/service.js";
import type { ProfileService } from "./profile/service.js";
import type { RepoService } from "./repos/service.js";
import type { Workspace } from "./workspace/workspace.js";

/** Everything MCP tools may use. Wired once in main.ts; tools never construct services. */
export interface Services {
  version: string;
  log: Logger;
  workspace: Workspace;
  postings: PostingsService;
  documents: DocumentsService;
  profile: ProfileService;
  github: GitHubService;
  repos: RepoService;
  bridge: ExtensionBridge;
}

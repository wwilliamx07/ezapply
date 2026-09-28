export { CHAT_SESSION_HEADER } from "./chat.js";
export {
  appDir,
  DaemonConfig,
  DEFAULT_IDLE_TIMEOUT_MINUTES,
  DEFAULT_PORT,
  daemonConfigPath,
  loadDaemonConfig,
  newPairingToken,
  newToken,
  saveDaemonConfig,
} from "./config/daemon.js";
export { defaultWorkspaceConfig, WorkspaceConfig } from "./config/workspace.js";
export { ENGINES, type EngineId, resolveEngine } from "./documents/tex/engines.js";
export { FormsService } from "./forms/service.js";
export { KeyringStore } from "./github/secrets.js";
export { GitHubService } from "./github/service.js";
export { CHAT_PATH, HEALTH_PATH, MCP_PATH, PAIR_PATH, SHUTDOWN_PATH } from "./http.js";
export { createLogger } from "./logger.js";
export { type CompanionHandle, type CompanionOptions, startCompanion } from "./main.js";
export { ProfileService } from "./profile/service.js";
export { agentFileStatus, githubDetail, texStatus } from "./status.js";
export { TemplateService } from "./templates/service.js";
export { exists } from "./util/fs.js";
export { installCommand, installHint } from "./util/install-hints.js";
export { clearWhichCache, which } from "./util/proc.js";
export { waitFor } from "./util/wait.js";
export { COMPANION_VERSION } from "./version.js";
export { WORKSPACE_DIRS, Workspace } from "./workspace/workspace.js";

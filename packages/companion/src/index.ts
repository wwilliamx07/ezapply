export {
  appDir,
  DaemonConfig,
  DEFAULT_PORT,
  daemonConfigPath,
  loadDaemonConfig,
  newPairingToken,
  newToken,
  saveDaemonConfig,
} from "./config/daemon.js";
export { defaultWorkspaceConfig, WorkspaceConfig } from "./config/workspace.js";
export { ENGINES, type EngineId, resolveEngine } from "./documents/tex/engines.js";
export { KeyringStore } from "./github/secrets.js";
export { HEALTH_PATH, MCP_PATH } from "./http.js";
export { createLogger } from "./logger.js";
export { type CompanionHandle, type CompanionOptions, startCompanion } from "./main.js";
export { ProfileService } from "./profile/service.js";
export { which } from "./util/proc.js";
export { COMPANION_VERSION } from "./version.js";
export { WORKSPACE_DIRS, Workspace } from "./workspace/workspace.js";

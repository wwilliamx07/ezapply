// `@ezapply/companion/light`: the config, version and endpoints without the services, for CLI commands that must
// start fast (`ezapply mcp`, help). The index loads all of the companion: jsdom, pdf-lib, pdfjs, the MCP server.
export {
  AppConfig,
  appConfigPath,
  appDir,
  DEFAULT_PORT,
  loadAppConfig,
  newPairingToken,
  newToken,
  saveAppConfig,
} from "./config/app.js";
export { HEALTH_PATH, MCP_PATH, SESSION_ENV, SESSION_HEADER } from "./endpoints.js";
export { COMPANION_VERSION } from "./version.js";

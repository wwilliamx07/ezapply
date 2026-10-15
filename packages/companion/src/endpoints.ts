// What the companion's HTTP server and the CLI's MCP relay agree on. Kept free of imports so the relay can load it
// without the companion.

export const MCP_PATH = "/mcp";
export const HEALTH_PATH = "/health";

/** The environment variable the MCP relay passes on as `SESSION_HEADER`, naming the conversation's session. */
export const SESSION_ENV = "EZAPPLY_SESSION";
/** The header the MCP relay names the conversation's session in. */
export const SESSION_HEADER = "x-ezapply-session";

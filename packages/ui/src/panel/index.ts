// The side panel, bundled into the extension (extension/src/panel/): its page mounts PanelApp with a transport over
// the extension's background.
export { Conversation, PanelApp, REQUESTS, withEvent } from "./App.js";
export { AskCardView, answerOf, initialDraft, PermissionCardView, permissionBody } from "./cards.js";
export { inline, Markdown } from "./markdown.js";
export type { CaptureOutcome, ConnectionState, PanelPush, PanelTransport } from "./transport.js";

/**
 * The WebExtensions API: Firefox's promise-based `browser`, else Chrome's `chrome`. The surface
 * this extension uses is the same in both, so it keeps Chrome's types.
 */
export const ext: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;

/** True in Firefox, whose MV3 background is an event page rather than a service worker. */
export const isFirefox = ext.runtime.getURL("").startsWith("moz-extension:");

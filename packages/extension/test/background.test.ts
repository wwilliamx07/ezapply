import { describe, expect, it, vi } from "vitest";

/** Just enough of the WebExtensions API for the background module to load outside a browser. */
const event = () => ({ addListener: vi.fn() });
/** The toolbar button's click listener, kept outside the mock (mock calls are cleared between tests). */
let clickListener: ((tab: unknown) => void) | undefined;
const chromeStub = {
  runtime: {
    getManifest: () => ({ version: "1.0.0" }),
    getURL: (p: string) => `chrome-extension://abcdefghijklmnopabcdefghijklmnop/${p}`,
    onInstalled: event(),
    onStartup: event(),
    openOptionsPage: vi.fn(async () => {}),
  },
  action: {
    onClicked: {
      addListener: (l: (tab: unknown) => void) => {
        clickListener = l;
      },
    },
    setBadgeText: vi.fn(async () => {}),
    setBadgeBackgroundColor: vi.fn(async () => {}),
    setTitle: vi.fn(async () => {}),
  },
  alarms: {
    get: vi.fn(async (_name: string): Promise<unknown> => undefined),
    create: vi.fn(async (_name: string, _info: unknown) => {}),
    onAlarm: event(),
  },
  storage: {
    local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}), remove: vi.fn(async () => {}) },
    session: { set: vi.fn(async () => {}) },
    onChanged: event(),
  },
  tabs: { query: vi.fn(async () => []) },
  windows: { getLastFocused: vi.fn(async () => ({ id: 1 })) },
  scripting: { executeScript: vi.fn() },
  permissions: { contains: vi.fn(async () => true), request: vi.fn(async (_p: unknown) => true) },
};
(globalThis as unknown as { chrome: unknown }).chrome = chromeStub;
// Nothing may connect anywhere: a socket that never opens.
(globalThis as unknown as { WebSocket: unknown }).WebSocket = class {
  close() {}
  send() {}
};

describe("background lifecycle", () => {
  it("creates the reconnect alarm whenever the background starts, not only at install", async () => {
    const { RECONNECT_ALARM } = await import("../src/background/index.js");
    await vi.waitFor(() => expect(chromeStub.alarms.create).toHaveBeenCalled());
    expect(chromeStub.alarms.create).toHaveBeenCalledWith(RECONNECT_ALARM, { periodInMinutes: 0.5 });
    // The stub never fires onInstalled or onStartup: loading the module (a browser restart) was enough.
    expect(chromeStub.runtime.onInstalled.addListener).toHaveBeenCalled();
    expect(chromeStub.alarms.onAlarm.addListener).toHaveBeenCalled();
  });

  it("leaves an existing alarm alone, so a wake-up doesn't push its next firing back", async () => {
    const { ensureReconnectAlarm, RECONNECT_ALARM } = await import("../src/background/index.js");
    chromeStub.alarms.create.mockClear();
    chromeStub.alarms.get.mockResolvedValueOnce({ name: RECONNECT_ALARM, periodInMinutes: 0.5 });
    await ensureReconnectAlarm();
    expect(chromeStub.alarms.create).not.toHaveBeenCalled();
  });
});

describe("Set posting", () => {
  const click = async (url: string) => {
    await import("../src/background/index.js");
    chromeStub.permissions.request.mockClear();
    clickListener?.({ id: 3, url, index: 0, windowId: 1 });
  };

  it("asks for an Oracle career site's origin in the click itself, while it counts as the user's gesture", async () => {
    await click("https://jobs.umbrella.example/en/sites/CX_1/job/10001");
    // Called synchronously: Firefox refuses permissions.request once the handler has awaited anything.
    expect(chromeStub.permissions.request).toHaveBeenCalledWith({ origins: ["https://jobs.umbrella.example/*"] });
  });

  it("asks nothing on other pages", async () => {
    await click("https://boards.greenhouse.io/acme/jobs/1");
    expect(chromeStub.permissions.request).not.toHaveBeenCalled();
  });
});

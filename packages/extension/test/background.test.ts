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
  tabs: {
    query: vi.fn(async () => []),
    get: vi.fn(async (_id: number): Promise<unknown> => undefined),
    update: vi.fn(async (_id: number, _props: unknown) => ({})),
  },
  windows: {
    getLastFocused: vi.fn(async () => ({ id: 1 })),
    get: vi.fn(async (_id: number): Promise<unknown> => ({ id: 1, focused: true, state: "normal" })),
    update: vi.fn(async (_id: number, _props: unknown) => ({})),
  },
  scripting: { executeScript: vi.fn(async (_injection: unknown): Promise<unknown> => []) },
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

  it("asks for any site granted per origin the same way: a Greenhouse board", async () => {
    await click("https://job-boards.greenhouse.io/acme/jobs/1");
    expect(chromeStub.permissions.request).toHaveBeenCalledWith({ origins: ["https://job-boards.greenhouse.io/*"] });
  });

  it("asks nothing on Workday (its hosts come with the install) or on pages of no form site", async () => {
    for (const url of [
      "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x",
      "https://www.example.com/careers/1",
    ]) {
      await click(url);
      expect(chromeStub.permissions.request).not.toHaveBeenCalled();
    }
  });
});

describe("tab.show", () => {
  const APPLY = "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply";
  /** The tab as tabs.get gives it, and what the page answers for each visibility read, in order. */
  const show = async (tab: { active: boolean }, hidden: boolean[], activate = true, focused = true) => {
    const { formHandlers } = await import("../src/background/forms.js");
    chromeStub.tabs.update.mockClear();
    chromeStub.windows.update.mockClear();
    chromeStub.scripting.executeScript.mockReset();
    chromeStub.tabs.get.mockResolvedValue({ id: 5, windowId: 1, url: APPLY, ...tab });
    // The page has focus only when it's visible and the window is in front (`focused`).
    const page = (h: boolean | undefined) => [{ result: { hidden: h, focused: !h && focused } }];
    for (const h of hidden) chromeStub.scripting.executeScript.mockResolvedValueOnce(page(h));
    chromeStub.scripting.executeScript.mockResolvedValue(page(hidden.at(-1)));
    return formHandlers["tab.show"]({ tabId: 5, activate });
  };

  /**
   * `focusWindow` asked for, with the window as windows.get gives it, and what the page answers for each read:
   * `[hidden, focused]`, in order.
   */
  const raise = async (win: { focused: boolean; state: string }, reads: [boolean, boolean][], activate = true) => {
    const { formHandlers } = await import("../src/background/forms.js");
    chromeStub.tabs.update.mockClear();
    chromeStub.windows.update.mockClear();
    chromeStub.windows.get.mockResolvedValueOnce({ id: 1, ...win });
    chromeStub.scripting.executeScript.mockReset();
    chromeStub.tabs.get.mockResolvedValue({ id: 5, windowId: 1, url: APPLY, active: true });
    const page = ([hidden, focused]: [boolean, boolean]) => [{ result: { hidden, focused } }];
    for (const r of reads) chromeStub.scripting.executeScript.mockResolvedValueOnce(page(r));
    chromeStub.scripting.executeScript.mockResolvedValue(page(reads.at(-1) as [boolean, boolean]));
    return formHandlers["tab.show"]({ tabId: 5, activate, focusWindow: true });
  };

  it("brings the browser window to the front with focusWindow, and waits for the page to get focus", async () => {
    expect(
      await raise({ focused: false, state: "normal" }, [
        [false, false],
        [false, true],
      ]),
    ).toEqual({ tabId: 5, activated: false, windowFocused: true, hidden: false, focused: true });
    expect(chromeStub.windows.update).toHaveBeenCalledWith(1, { focused: true });
    expect(chromeStub.scripting.executeScript).toHaveBeenCalledTimes(2);
  });

  it("restores a minimized window", async () => {
    expect(await raise({ focused: false, state: "minimized" }, [[false, true]])).toMatchObject({
      windowFocused: true,
      focused: true,
    });
    expect(chromeStub.windows.update).toHaveBeenCalledWith(1, { focused: true, state: "normal" });
  });

  it("leaves a window that's already in front alone", async () => {
    expect(await raise({ focused: true, state: "maximized" }, [[false, true]])).toEqual({
      tabId: 5,
      activated: false,
      hidden: false,
      focused: true,
    });
    expect(chromeStub.windows.update).not.toHaveBeenCalled();
  });

  it("reports a window the system kept behind", async () => {
    expect(await raise({ focused: false, state: "normal" }, [[false, false]])).toEqual({
      tabId: 5,
      activated: false,
      windowFocused: true,
      hidden: false,
      focused: false,
    });
    expect(chromeStub.scripting.executeScript).toHaveBeenCalledTimes(10);
  });

  it("never raises the window with activate: false (a review page waits)", async () => {
    await raise({ focused: false, state: "normal" }, [[false, false]], false);
    expect(chromeStub.windows.update).not.toHaveBeenCalled();
    chromeStub.windows.get.mockReset();
    chromeStub.windows.get.mockResolvedValue({ id: 1, focused: true, state: "normal" });
  });

  it("still switches the tab when the window can't be raised", async () => {
    chromeStub.windows.update.mockRejectedValueOnce(new Error("No window with id: 1."));
    const { formHandlers } = await import("../src/background/forms.js");
    chromeStub.tabs.update.mockClear();
    chromeStub.windows.get.mockResolvedValueOnce({ id: 1, focused: false, state: "normal" });
    chromeStub.scripting.executeScript.mockReset();
    chromeStub.scripting.executeScript.mockResolvedValue([{ result: { hidden: false, focused: false } }]);
    chromeStub.tabs.get.mockResolvedValue({ id: 5, windowId: 1, url: APPLY, active: false });
    expect(await formHandlers["tab.show"]({ tabId: 5, activate: true, focusWindow: true })).toEqual({
      tabId: 5,
      activated: true,
      hidden: false,
      focused: false,
    });
    expect(chromeStub.tabs.update).toHaveBeenCalledWith(5, { active: true });
  });

  it("switches to an application tab in the background and waits for the page to notice", async () => {
    expect(await show({ active: false }, [true, true, false])).toEqual({
      tabId: 5,
      activated: true,
      hidden: false,
      focused: true,
    });
    expect(chromeStub.tabs.update).toHaveBeenCalledWith(5, { active: true });
    expect(chromeStub.scripting.executeScript).toHaveBeenCalledTimes(3);
    // Without focusWindow the browser window isn't focused: that would pull it in front of the user's terminal.
    expect(chromeStub.windows.update).not.toHaveBeenCalled();
  });

  it("leaves a tab that's already in front alone", async () => {
    expect(await show({ active: true }, [false])).toEqual({ tabId: 5, activated: false, hidden: false, focused: true });
    expect(chromeStub.tabs.update).not.toHaveBeenCalled();
  });

  it("only reports with activate: false", async () => {
    expect(await show({ active: false }, [true], false)).toEqual({
      tabId: 5,
      activated: false,
      hidden: true,
      focused: false,
    });
    expect(chromeStub.tabs.update).not.toHaveBeenCalled();
  });

  it("reports a page without focus: its window is behind another app", async () => {
    expect(await show({ active: true }, [false], true, false)).toEqual({
      tabId: 5,
      activated: false,
      hidden: false,
      focused: false,
    });
    expect(chromeStub.windows.update).not.toHaveBeenCalled();
  });

  it("reports a tab still hidden after switching (a minimized window), without forcing it", async () => {
    expect(await show({ active: false }, [true])).toEqual({ tabId: 5, activated: true, hidden: true, focused: false });
    expect(chromeStub.windows.update).not.toHaveBeenCalled();
  });
});

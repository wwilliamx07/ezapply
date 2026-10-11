import { describe, expect, it, vi } from "vitest";

/** Just enough of the WebExtensions API for the background module to load outside a browser. */
const event = () => ({ addListener: vi.fn() });
/** The URL of the first window the background opened (the access window). */
const openedUrl = () => ((chromeStub.windows.create.mock.calls[0]?.[0] ?? { url: "" }) as { url: string }).url;
/** Listeners for granted permissions (`permissions.onAdded`), so a test can play the user allowing access. */
const grantListeners = new Set<() => void>();
/** The toolbar button's click listener, kept outside the mock (mock calls are cleared between tests). */
let clickListener: ((tab: unknown) => void) | undefined;
/** The listener for ports (the side panel's). */
let connectListener: ((port: unknown) => void) | undefined;
/** What the background asked of Chrome's side panel when it loaded. */
let panelBehavior: unknown;
/** The keyboard shortcut's listener (Capture). */
let commandListener: ((command: string, tab: unknown) => void) | undefined;
const chromeStub = {
  runtime: {
    getManifest: () => ({ version: "1.0.0" }),
    getURL: (p: string) => `chrome-extension://abcdefghijklmnopabcdefghijklmnop/${p}`,
    onInstalled: event(),
    onStartup: event(),
    onConnect: {
      addListener: (l: (port: unknown) => void) => {
        connectListener = l;
      },
    },
    openOptionsPage: vi.fn(async () => {}),
  },
  commands: {
    onCommand: {
      addListener: (l: (command: string, tab: unknown) => void) => {
        commandListener = l;
      },
    },
  },
  sidePanel: {
    setPanelBehavior: async (o: unknown) => {
      panelBehavior = o;
    },
  },
  sidebarAction: { toggle: vi.fn(async () => {}) },
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
    query: vi.fn(async (_q?: unknown): Promise<unknown[]> => []),
    get: vi.fn(async (_id: number): Promise<unknown> => undefined),
    update: vi.fn(async (_id: number, _props: unknown) => ({})),
    create: vi.fn(async (_props: unknown) => ({})),
    onActivated: event(),
    onUpdated: event(),
  },
  webNavigation: {
    getAllFrames: vi.fn(async (_d: { tabId: number }): Promise<unknown[] | null> => []),
    getFrame: vi.fn(async (_d: { tabId: number; frameId: number }): Promise<unknown> => null),
  },
  windows: {
    getLastFocused: vi.fn(async () => ({ id: 1 })),
    get: vi.fn(async (_id: number): Promise<unknown> => ({ id: 1, focused: true, state: "normal" })),
    update: vi.fn(async (_id: number, _props: unknown) => ({})),
    create: vi.fn(async (_props: unknown): Promise<unknown> => ({ id: 42 })),
  },
  scripting: { executeScript: vi.fn(async (_injection: unknown): Promise<unknown> => []) },
  permissions: {
    contains: vi.fn(async (_p?: unknown) => true),
    request: vi.fn(async (_p: unknown) => true),
    onAdded: {
      addListener: vi.fn((l: () => void) => grantListeners.add(l)),
      removeListener: vi.fn((l: () => void) => grantListeners.delete(l)),
    },
  },
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

describe("the toolbar button", () => {
  it("opens the side panel: Chrome's by itself, Firefox's sidebar toggled in the click", async () => {
    await import("../src/background/index.js");
    expect(panelBehavior).toEqual({ openPanelOnActionClick: true });
    clickListener?.({ id: 3, url: "https://example.com/", index: 0, windowId: 1 });
    expect(chromeStub.sidebarAction.toggle).toHaveBeenCalledTimes(1);
    // A click captures nothing: Capture is the panel's button, or the shortcut.
    expect(chromeStub.scripting.executeScript).not.toHaveBeenCalled();
  });
});

describe("Capture", () => {
  /** The keyboard shortcut on a page. */
  const click = async (url: string) => {
    await import("../src/background/index.js");
    chromeStub.permissions.request.mockClear();
    commandListener?.("set-posting", { id: 3, url, index: 0, windowId: 1 });
  };

  it("asks for every site in the shortcut's handler itself, while it counts as the user's gesture", async () => {
    await click("https://jobs.umbrella.example/en/sites/CX_1/job/10001");
    // Called synchronously: Firefox refuses permissions.request once the handler has awaited anything. Already
    // granted (Chrome, from the install), it resolves without asking.
    expect(chromeStub.permissions.request).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
  });

  it("asks nothing on a page that isn't on the web", async () => {
    await click("chrome://extensions/");
    expect(chromeStub.permissions.request).not.toHaveBeenCalled();
  });
});

describe("telling a page's site", () => {
  const POSTING = "https://careers.example.com/global/en/job/R-0000000001/Software-Developer-Intern";
  /** executeScript answering the site check (`pageSite`) with `sites` by frame, and anything else with `other`. */
  const pagesShow = (sites: Record<number, string | null>, other: unknown[] = []) => {
    chromeStub.scripting.executeScript.mockReset();
    chromeStub.scripting.executeScript.mockImplementation(async (injection: unknown) => {
      const { func, target } = injection as { func?: { name: string }; target: { frameIds?: number[] } };
      if (func?.name !== "pageSite") return other;
      return Object.entries(sites)
        .filter(([id]) => !target.frameIds || target.frameIds.includes(Number(id)))
        .map(([id, site]) => ({ frameId: Number(id), result: { url: "", site } }));
    });
  };

  it("matches each site's signature in the page, the first in registry order", async () => {
    const { pageSite } = await import("../src/background/frames.js");
    const { siteSignatures } = await import("@ezapply/protocol");
    const { JSDOM } = await import("jsdom");
    const { window } = new JSDOM(
      '<body><div class="ph-apply-box"><div data-ph-at-id="apply-link"></div></div></body>',
      { url: POSTING },
    );
    vi.stubGlobal("document", window.document);
    vi.stubGlobal("location", window.location);
    try {
      expect(pageSite(siteSignatures())).toEqual({ url: POSTING, site: "phenom" });
      expect(
        pageSite([
          ["lever", "a.postings-btn"],
          ["phenom", "[data-ph-at-id]"],
        ]),
      ).toMatchObject({ site: "phenom" });
      // A selector the browser can't parse is skipped, not fatal.
      expect(
        pageSite([
          ["ashby", "::nonsense("],
          ["phenom", ".ph-apply-box"],
        ]),
      ).toMatchObject({ site: "phenom" });
      window.document.body.innerHTML = "<p>Careers</p>";
      expect(pageSite(siteSignatures())).toEqual({ url: POSTING, site: null });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("knows a tab by what its page shows, whatever its URL, and falls back on the URL", async () => {
    const { tabSite } = await import("../src/background/frames.js");
    pagesShow({ 0: "phenom" });
    expect(await tabSite({ id: 5, url: POSTING } as chrome.tabs.Tab)).toBe("phenom");
    expect(chromeStub.scripting.executeScript.mock.calls[0]?.[0]).toMatchObject({
      target: { tabId: 5 },
      injectImmediately: true,
    });
    // The page shows no site: its URL decides.
    pagesShow({ 0: null });
    expect(await tabSite({ id: 5, url: POSTING } as chrome.tabs.Tab)).toBe("generic");
    expect(
      await tabSite({ id: 5, url: "https://acme.wd5.myworkdayjobs.com/en-US/External/job/x" } as chrome.tabs.Tab),
    ).toBe("workday");
    // A page that can't be read (no access, a browser page) or is discarded: its URL, without asking it.
    chromeStub.scripting.executeScript.mockRejectedValueOnce(new Error("Cannot access contents of the page"));
    expect(await tabSite({ id: 5, url: POSTING } as chrome.tabs.Tab)).toBe("generic");
    chromeStub.scripting.executeScript.mockClear();
    expect(await tabSite({ id: 5, url: POSTING, discarded: true } as chrome.tabs.Tab)).toBe("generic");
    expect(chromeStub.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("lets the URL decide when the page doesn't answer in time", async () => {
    const { tabSite } = await import("../src/background/frames.js");
    vi.useFakeTimers();
    try {
      chromeStub.scripting.executeScript.mockReset();
      chromeStub.scripting.executeScript.mockImplementation(() => new Promise(() => {}));
      const site = tabSite({ id: 5, url: "https://jobs.lever.co/acme/1" } as chrome.tabs.Tab);
      await vi.advanceTimersByTimeAsync(1_500);
      await expect(site).resolves.toBe("lever");
    } finally {
      vi.useRealTimers();
    }
  });

  it("fills a form on a site its page shows, on a URL that names none", async () => {
    const { formHandlers } = await import("../src/background/forms.js");
    chromeStub.tabs.get.mockResolvedValue({ id: 5, windowId: 1, url: POSTING, active: true });
    chromeStub.permissions.contains.mockResolvedValue(true);
    pagesShow({ 0: "phenom" }, [{ result: { __ok: { adapter: "phenom", url: POSTING } } }]);
    expect(await formHandlers["form.get"]({ tabId: 5 })).toMatchObject({ adapter: "phenom", tabId: 5 });
    const files = chromeStub.scripting.executeScript.mock.calls.map((c) => (c[0] as { files?: string[] }).files);
    expect(files).toContainEqual(["phenom-main.js"]);
  });

  it("refuses a tab whose page shows no form site, and whose URL is none", async () => {
    const { formHandlers } = await import("../src/background/forms.js");
    chromeStub.tabs.get.mockResolvedValue({ id: 5, windowId: 1, url: POSTING, active: true });
    pagesShow({ 0: null });
    await expect(formHandlers["form.get"]({ tabId: 5 })).rejects.toMatchObject({
      code: "bad_request",
      message: expect.stringMatching(/not an application page of a supported site/),
    });
  });

  it("sends the site the posting's page shows with its capture", async () => {
    await import("../src/background/index.js");
    chromeStub.storage.local.set.mockClear();
    const page = {
      url: POSTING,
      pageTitle: "Careers",
      html: "<p>Job</p>",
      visibleHtml: "<p>Job</p>",
      visibleText: "Job",
      jsonLd: [],
      frames: [],
    };
    pagesShow({ 0: "phenom" }, [{ frameId: 0, result: page }]);
    commandListener?.("set-posting", { id: 3, url: POSTING, index: 0, windowId: 1 });
    // The companion isn't connected here: the capture waits in storage, as it's sent.
    await vi.waitFor(() =>
      expect(chromeStub.storage.local.set).toHaveBeenCalledWith({
        pendingCapture: expect.objectContaining({ url: POSTING, site: "phenom" }),
      }),
    );
  });
});

describe("embedded application forms", () => {
  const HOST = "https://careers.example.com/jobs/1?gh_jid=1000001";
  const EMBED = "https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1000001";
  const FORM = "https://apply.example.net/forms/1";
  const frames = [
    { frameId: 0, parentFrameId: -1, url: HOST },
    { frameId: 7, parentFrameId: 0, url: EMBED },
    { frameId: 8, parentFrameId: 0, url: "https://www.youtube.com/embed/x" },
    { frameId: 9, parentFrameId: 0, url: "about:blank" },
    { frameId: 10, parentFrameId: 0, url: FORM },
  ];

  it("lists a tab's frames on a form site, by their pages or else their URLs, never the top frame", async () => {
    const { tabSites } = await import("../src/background/frames.js");
    chromeStub.webNavigation.getAllFrames.mockResolvedValueOnce(frames);
    chromeStub.scripting.executeScript.mockReset();
    // Frame 10's URL names no site, but its page is a Phenom form; frame 7 didn't answer.
    chromeStub.scripting.executeScript.mockResolvedValueOnce([
      { frameId: 0, result: { url: HOST, site: null } },
      { frameId: 8, result: { url: "", site: null } },
      { frameId: 10, result: { url: FORM, site: "phenom" } },
    ]);
    expect(await tabSites({ id: 5, url: HOST } as chrome.tabs.Tab)).toEqual({
      site: "generic",
      frames: [
        { frameId: 7, url: EMBED, site: "greenhouse" },
        { frameId: 10, url: FORM, site: "phenom" },
      ],
    });
    expect(chromeStub.scripting.executeScript.mock.calls[0]?.[0]).toMatchObject({
      target: { tabId: 5, allFrames: true },
    });
    // A tab that can't be listed (discarded, closed) has none.
    chromeStub.webNavigation.getAllFrames.mockRejectedValueOnce(new Error("No tab with id: 5."));
    expect((await tabSites({ id: 5, url: HOST } as chrome.tabs.Tab)).frames).toEqual([]);
  });

  /** A form call on frame 7 of tab 5, the frame still there, with or without access to its origin. */
  const onFrame = async (access = true) => {
    const { formHandlers } = await import("../src/background/forms.js");
    chromeStub.tabs.get.mockResolvedValue({ id: 5, windowId: 1, url: HOST, active: true });
    chromeStub.webNavigation.getFrame.mockResolvedValue({ frameId: 7, url: EMBED });
    chromeStub.permissions.contains.mockReset();
    chromeStub.permissions.contains.mockResolvedValueOnce(access);
    chromeStub.permissions.contains.mockResolvedValue(true);
    chromeStub.scripting.executeScript.mockReset();
    chromeStub.scripting.executeScript.mockResolvedValue([{ result: { __ok: { adapter: "greenhouse", url: EMBED } } }]);
    return formHandlers;
  };

  it("injects the adapter into the form's frame alone, after checking access to the frame's origin", async () => {
    const handlers = await onFrame();
    expect(await handlers["form.get"]({ tabId: 5, frameId: 7 })).toMatchObject({ tabId: 5, frameId: 7, url: EMBED });
    expect(chromeStub.permissions.contains).toHaveBeenCalledWith({ origins: ["https://job-boards.greenhouse.io/*"] });
    const targets = chromeStub.scripting.executeScript.mock.calls.map((c) => (c[0] as { target: unknown }).target);
    // The site check, the adapter, the call.
    expect(targets).toEqual([
      { tabId: 5, frameIds: [7] },
      { tabId: 5, frameIds: [7] },
      { tabId: 5, frameIds: [7] },
    ]);
    expect(chromeStub.scripting.executeScript.mock.calls[1]?.[0]).toMatchObject({ files: ["greenhouse-main.js"] });
  });

  it("asks for access to websites when the frame's origin isn't granted, naming the frame's host", async () => {
    const handlers = await onFrame(false);
    chromeStub.windows.create.mockClear();
    const call = handlers["form.get"]({ tabId: 5, frameId: 7 });
    await vi.waitFor(() => expect(chromeStub.windows.create).toHaveBeenCalled());
    const query = new URL(openedUrl()).searchParams;
    expect([query.get("origins"), query.get("host")]).toEqual(["<all_urls>", "job-boards.greenhouse.io"]);
    for (const l of grantListeners) l();
    await expect(call).resolves.toMatchObject({ frameId: 7 });
  });

  it("fails a call on a frame that's gone, as on a closed tab", async () => {
    const handlers = await onFrame();
    chromeStub.webNavigation.getFrame.mockResolvedValue(null);
    await expect(handlers["form.next"]({ tabId: 5, frameId: 7 })).rejects.toMatchObject({ code: "not_found" });
    expect(chromeStub.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("reads an embedded form's visibility in its frame, and focus from the browser window", async () => {
    const handlers = await onFrame();
    chromeStub.scripting.executeScript.mockResolvedValue([{ result: { hidden: false, focused: false } }]);
    chromeStub.windows.get.mockResolvedValueOnce({ id: 1, focused: true, state: "normal" });
    expect(await handlers["tab.show"]({ tabId: 5, frameId: 7, activate: true })).toEqual({
      tabId: 5,
      activated: false,
      hidden: false,
      focused: true,
    });
    expect(chromeStub.scripting.executeScript.mock.calls[0]?.[0]).toMatchObject({
      target: { tabId: 5, frameIds: [7] },
    });
  });

  it("opens a job board it couldn't read in its own tab (access to websites withheld)", async () => {
    await import("../src/background/index.js");
    chromeStub.tabs.create.mockClear();
    chromeStub.permissions.request.mockResolvedValueOnce(false);
    chromeStub.scripting.executeScript.mockReset();
    // The careers page, which shows the Greenhouse frame it can't read.
    chromeStub.scripting.executeScript.mockResolvedValue([
      {
        frameId: 0,
        result: {
          url: HOST,
          pageTitle: "Careers",
          html: "<p>Careers</p>",
          visibleHtml: "<p>Careers</p>",
          visibleText: "Careers",
          jsonLd: [],
          frames: [{ src: EMBED, width: 800, height: 1200 }],
        },
      },
    ]);
    commandListener?.("set-posting", { id: 3, url: HOST, index: 0, windowId: 1 });
    expect(chromeStub.permissions.request).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
    await vi.waitFor(() =>
      expect(chromeStub.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: EMBED })),
    );
  });
});

describe("asking for access to websites when a form call finds it missing", () => {
  const APPLY = "https://jobs.globex.example/ca/en/apply?jobSeqNo=X1&step=1";
  /**
   * A form call on a Phenom tab whose origin isn't granted; `allow` plays the user granting access. One window asks
   * for every site, so an earlier test's may still be open: `fresh` has the user close it first.
   */
  const call = async (url = APPLY, fresh = true) => {
    const { formHandlers } = await import("../src/background/forms.js");
    if (fresh) chromeStub.windows.get.mockRejectedValueOnce(new Error("No window with id: 42."));
    chromeStub.tabs.get.mockResolvedValue({ id: 9, windowId: 1, url, active: true });
    chromeStub.windows.create.mockClear();
    chromeStub.windows.update.mockClear();
    chromeStub.permissions.contains.mockReset();
    chromeStub.permissions.contains.mockResolvedValue(false);
    chromeStub.scripting.executeScript.mockReset();
    chromeStub.scripting.executeScript.mockResolvedValue([{ result: { __ok: { adapter: "phenom", url } } }]);
    return formHandlers["form.get"]({ tabId: 9 });
  };
  const allow = () => {
    chromeStub.permissions.contains.mockResolvedValue(true);
    for (const l of grantListeners) l();
  };

  it("opens a window whose Allow access asks for every site, and goes on once the user allows it", async () => {
    const pending = call();
    await vi.waitFor(() => expect(chromeStub.windows.create).toHaveBeenCalledTimes(1));
    const opened = chromeStub.windows.create.mock.calls[0]?.[0] as { url: string; type: string };
    expect(opened.type).toBe("popup");
    const query = new URL(opened.url).searchParams;
    expect([query.get("origins"), query.get("host")]).toEqual(["<all_urls>", "jobs.globex.example"]);
    // Nothing is read or injected until it's granted.
    expect(chromeStub.scripting.executeScript).not.toHaveBeenCalled();
    allow();
    await expect(pending).resolves.toMatchObject({ adapter: "phenom", tabId: 9 });
    expect(chromeStub.scripting.executeScript).toHaveBeenCalled();
  });

  it("says to call again once allowed when the user takes longer, and a retry brings the same window forward", async () => {
    vi.useFakeTimers();
    try {
      const first = call("https://jobs.initech.example/ca/en/apply?jobSeqNo=X2");
      const failed = expect(first).rejects.toMatchObject({
        message: "The extension has no access to jobs.initech.example yet.",
        hint: expect.stringMatching(/small ezapply window.*call again/),
      });
      await vi.advanceTimersByTimeAsync(15_000);
      await failed;
      expect(chromeStub.windows.create).toHaveBeenCalledTimes(1);
      const second = call("https://jobs.initech.example/ca/en/apply?jobSeqNo=X2", false);
      await vi.advanceTimersByTimeAsync(10);
      expect(chromeStub.windows.create).not.toHaveBeenCalled();
      expect(chromeStub.windows.update).toHaveBeenCalledWith(42, { focused: true, state: "normal" });
      allow();
      await expect(second).resolves.toMatchObject({ adapter: "phenom" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("the window asks only for every site or host patterns from its URL", async () => {
    const { originsFrom } = await import("../src/grant/grant.js");
    const q = (o: string) => `?${new URLSearchParams({ origins: o })}`;
    expect(originsFrom(q("<all_urls>"))).toEqual(["<all_urls>"]);
    expect(originsFrom(q("https://jobs.globex.example/* *://*.myworkdayjobs.com/*"))).toEqual([
      "https://jobs.globex.example/*",
      "*://*.myworkdayjobs.com/*",
    ]);
    expect(originsFrom(q("<all_urls>x http://x.example/* https://x.example/path/* file:///*"))).toEqual([]);
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

describe("the side panel's port", () => {
  /** A panel's port: what it was sent, and a way to send it a request. */
  function panelPort() {
    const sent: unknown[] = [];
    let onMessage: ((m: unknown) => void) | undefined;
    const port = {
      name: "ezapply-panel",
      postMessage: (m: unknown) => sent.push(m),
      onMessage: { addListener: (l: (m: unknown) => void) => (onMessage = l) },
      onDisconnect: { addListener: () => {} },
    };
    connectListener?.(port);
    const ask = async (m: Record<string, unknown>) => {
      onMessage?.(m);
      await vi.waitFor(() => expect(sent.some((r) => (r as { id?: unknown }).id === m.id)).toBe(true));
      return sent.find((r) => (r as { id?: unknown }).id === m.id) as { ok: boolean; result?: unknown; error?: string };
    };
    return { sent, ask };
  }

  it("relays only the panel's methods, and answers what the background knows itself", async () => {
    await import("../src/background/index.js");
    const { ask } = panelPort();
    // Not a panel method: a panel can't capture or fill through the relay.
    expect(await ask({ type: "call", id: 1, method: "posting.capture", params: {} })).toMatchObject({
      ok: false,
      error: expect.stringContaining("Not a panel method"),
    });
    expect(await ask({ type: "connection", id: 2 })).toMatchObject({ ok: true, result: { state: "unconfigured" } });
    expect(await ask({ type: "openTab", id: 3, windowId: 1, url: "javascript:alert(1)" })).toMatchObject({ ok: false });
    expect(await ask({ type: "openTab", id: 4, windowId: 1, url: "https://example.com/apply" })).toMatchObject({
      ok: true,
    });
    expect(chromeStub.tabs.create).toHaveBeenCalledWith({
      url: "https://example.com/apply",
      windowId: 1,
      active: true,
    });
    chromeStub.tabs.query.mockResolvedValueOnce([]);
    expect(await ask({ type: "capture", id: 5, windowId: 1 })).toMatchObject({ ok: true, result: { ok: false } });
    // Without a connection there's no "this tab" to tell.
    chromeStub.tabs.query.mockResolvedValueOnce([{ id: 3, url: "https://example.com/", windowId: 1 }]);
    expect(await ask({ type: "tab", id: 6, windowId: 1 })).toMatchObject({ ok: true, result: null });
  });

  it("shows the companion's card count on the badge", async () => {
    const { panelUpdate } = await import("../src/background/panel.js");
    chromeStub.storage.local.get.mockResolvedValue({
      connState: { state: "connected", companionVersion: "x" },
    } as never);
    // The tooltip always says it; the badge's text too, unless an earlier capture's ✓ or ! is still flashing.
    await panelUpdate({ cards: 2 });
    expect(chromeStub.action.setTitle).toHaveBeenLastCalledWith({
      title: expect.stringContaining("2 waiting for you in the panel."),
    });
    await panelUpdate({ cards: 0 });
    expect(chromeStub.action.setTitle).toHaveBeenLastCalledWith({
      title: expect.not.stringContaining("waiting for you"),
    });
    chromeStub.storage.local.get.mockResolvedValue({} as never);
  });
});

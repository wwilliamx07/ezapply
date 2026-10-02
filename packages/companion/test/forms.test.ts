import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TIMING, type TabInfo } from "@ezapply/protocol";
import { describe, expect, it } from "vitest";
import type { ExtensionBridge } from "../src/bridge/server.js";
import { pruneDebug, stripBulk } from "../src/forms/debug.js";
import { FormsService } from "../src/forms/service.js";
import { loadTiming, TIMING_FILE, timingFileTemplate } from "../src/forms/timing.js";
import { createLogger } from "../src/logger.js";
import type { PostingsService } from "../src/postings/service.js";
import type { Workspace } from "../src/workspace/workspace.js";

const tab = (tabId: number): TabInfo => ({
  tabId,
  windowId: 1,
  url: `https://acme.wd5.myworkdayjobs.com/en-US/External/job/x/apply?t=${tabId}`,
  title: "Apply",
  active: tabId === 7,
  site: "workday",
});

/** A bridge whose page calls take a while and record how many run on each tab at once. */
function slowBridge() {
  const running = new Map<number, number>();
  const most = new Map<number, number>();
  const order: string[] = [];
  const call = async (method: string, params: { tabId?: number; fieldId?: string }) => {
    if (method === "browser.status") return { extensionVersion: "1", tabs: [tab(7), tab(8)] };
    const id = params.tabId as number;
    running.set(id, (running.get(id) ?? 0) + 1);
    most.set(id, Math.max(most.get(id) ?? 0, running.get(id) ?? 0));
    order.push(`${id}:${params.fieldId}:start`);
    await new Promise((r) => setTimeout(r, 30));
    order.push(`${id}:${params.fieldId}:end`);
    running.set(id, (running.get(id) ?? 1) - 1);
    return [{ label: `options of ${params.fieldId}` }];
  };
  return { bridge: { call } as unknown as ExtensionBridge, most, order };
}

/** A workspace whose files live in `dir` (by default one without autofill-timing.yaml). */
const workspaceAt = (dir = join(tmpdir(), "ezapply-no-such-workspace")) =>
  ({ path: (...p: string[]) => join(dir, ...p) }) as unknown as Workspace;

/** FormsService over `bridge`, with the tab always in front (`tab.show` is answered here, not by the bridge). */
function forms(bridge: ExtensionBridge, ws: Workspace = workspaceAt()) {
  const postings = { activeId: async () => null } as unknown as PostingsService;
  const shown = {
    call: (method: string, params: { tabId: number }, timeoutMs?: number) =>
      method === "tab.show"
        ? Promise.resolve({ tabId: params.tabId, activated: false, hidden: false })
        : (bridge.call as (m: string, p: unknown, t?: number) => Promise<unknown>)(method, params, timeoutMs),
  } as unknown as ExtensionBridge;
  const reviews = { pending: () => false } as never;
  return new FormsService(ws, postings, shown, reviews, {} as never, createLogger({ toFile: false, level: "silent" }));
}

describe("form calls on one tab", () => {
  it("run one at a time and in order, each reading its own field, while other tabs aren't held up", async () => {
    const b = slowBridge();
    const f = forms(b.bridge);
    const results = await Promise.all([
      f.listOptions("gender", 7),
      f.listOptions("disability", 7),
      f.listOptions("veteran", 7),
      f.listOptions("country", 8),
    ]);
    expect(results.map((r) => (r as { label: string }[])[0]?.label)).toEqual([
      "options of gender",
      "options of disability",
      "options of veteran",
      "options of country",
    ]);
    expect(b.most.get(7)).toBe(1);
    const tab7 = b.order.filter((e) => e.startsWith("7:"));
    expect(tab7).toEqual([
      "7:gender:start",
      "7:gender:end",
      "7:disability:start",
      "7:disability:end",
      "7:veteran:start",
      "7:veteran:end",
    ]);
    // Tab 8 started before tab 7's queue had drained.
    expect(b.order.indexOf("8:country:start")).toBeLessThan(b.order.indexOf("7:veteran:start"));
  });

  it("keep going after a call fails", async () => {
    const b = slowBridge();
    const failing = {
      call: async (method: string, params: { tabId?: number; fieldId?: string }) => {
        if (method !== "browser.status" && params.fieldId === "broken") throw new Error("listbox never opened");
        return (b.bridge.call as (m: string, p: unknown) => Promise<unknown>)(method, params);
      },
    } as unknown as ExtensionBridge;
    const f = forms(failing);
    const [first, second] = await Promise.allSettled([f.listOptions("broken", 7), f.listOptions("gender", 7)]);
    expect(first.status).toBe("rejected");
    expect(second).toMatchObject({ status: "fulfilled", value: [{ label: "options of gender" }] });
  });
});

describe("autofill-timing.yaml", () => {
  /** A bridge that records each call's params and timeout. */
  function recordingBridge() {
    const calls: { method: string; params: Record<string, unknown>; timeoutMs?: number }[] = [];
    const call = async (method: string, params: Record<string, unknown>, timeoutMs?: number) => {
      if (method === "browser.status") return { extensionVersion: "1", tabs: [tab(7)] };
      calls.push({ method, params, ...(timeoutMs ? { timeoutMs } : {}) });
      if (method === "form.get") {
        return {
          adapter: "workday",
          tabId: 7,
          url: tab(7).url,
          pageKind: "step",
          sections: [],
          addButtons: [],
          actions: [],
          errors: [],
        };
      }
      return [{ fieldId: "a", ok: true, readBack: "x" }];
    };
    return { bridge: { call } as unknown as ExtensionBridge, calls };
  }

  async function withFile(content: string | null, fn: (ws: Workspace) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), "ezapply-timing-"));
    try {
      if (content !== null) await writeFile(join(dir, TIMING_FILE), content, "utf8");
      await fn(workspaceAt(dir));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("sends the defaults without a file, and the template changes nothing", async () => {
    await withFile(null, async (ws) => {
      expect(await loadTiming(ws)).toEqual({ timing: DEFAULT_TIMING, fillTimeoutMs: 120_000, issues: [] });
    });
    await withFile(timingFileTemplate(), async (ws) => {
      expect(await loadTiming(ws)).toEqual({ timing: DEFAULT_TIMING, fillTimeoutMs: 120_000, issues: [] });
    });
  });

  it("sends the file's waits with every call, scaled, and its fill timeout", async () => {
    await withFile("scale: 0.5\ndropdownOpenMs: 800\npollMs: 20\nfillTimeoutSeconds: 300\n", async (ws) => {
      const b = recordingBridge();
      const f = forms(b.bridge, ws);
      await f.getForm({ tabId: 7 });
      await f.fill([{ fieldId: "a", value: "x", source: "profile" }], 7);
      const [get, fill] = b.calls;
      expect(get?.params.timing).toMatchObject({
        dropdownOpenMs: 800,
        afterFieldMaxMs: 750,
        dropdownClosedMs: 100,
        pollMs: 20,
      });
      expect(fill?.params.timing).toEqual(get?.params.timing);
      expect(fill?.timeoutMs).toBe(300_000);
    });
  });

  it("reads the file for every call, so an edit applies to the next one", async () => {
    await withFile("dropdownOpenMs: 800\n", async (ws) => {
      const b = recordingBridge();
      const f = forms(b.bridge, ws);
      await f.getForm({ tabId: 7 });
      await writeFile(ws.path(TIMING_FILE), "dropdownOpenMs: 300\n", "utf8");
      await f.getForm({ tabId: 7 });
      expect(b.calls.map((c) => (c.params.timing as Record<string, number>).dropdownOpenMs)).toEqual([800, 300]);
    });
  });

  it("falls back to the default for each mistake and says so in get_form, without failing the call", async () => {
    await withFile("dropdownOpenMs: fast\nbogusMs: 5\nscale: 50\n", async (ws) => {
      const f = forms(recordingBridge().bridge, ws);
      const form = await f.getForm({ tabId: 7 });
      expect(form.pageKind).toBe("step");
      expect(form.timingIssues).toEqual([
        "autofill-timing.yaml: dropdownOpenMs must be a number from 0 to 120000; using the default.",
        'autofill-timing.yaml: unknown key "bogusMs" ignored.',
        "autofill-timing.yaml: scale must be a number from 0.1 to 10; using the default.",
      ]);
    });
    await withFile("dropdownOpenMs: [\n", async (ws) => {
      const loaded = await loadTiming(ws);
      expect(loaded.timing).toEqual(DEFAULT_TIMING);
      expect(loaded.issues[0]).toMatch(/couldn't be read, so the defaults are used/);
    });
  });
});

describe("debug mode", () => {
  it("still records a call that timed out, with the bridge calls made before it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ezapply-debug-"));
    try {
      await writeFile(
        join(dir, "ezapply.config.json"),
        JSON.stringify({ schemaVersion: 1, debug: { autofill: true } }),
      );
      const bridge = {
        call: async (method: string) => {
          if (method === "browser.status") return { extensionVersion: "1", tabs: [tab(7)] };
          throw new Error("Request form.fill timed out after 120000 ms");
        },
      } as unknown as ExtensionBridge;
      const f = forms(bridge, workspaceAt(dir));
      await expect(f.fill([{ fieldId: "a", value: "x", source: "user" }], 7)).rejects.toThrow(/timed out/);
      await f.debugIdle();
      const session = join(dir, "debug", `${new Date().toISOString().slice(0, 10)}-no-posting`);
      const record = JSON.parse(await readFile(join(session, "0001-fill_fields.json"), "utf8"));
      expect(record).toMatchObject({
        tool: "fill_fields",
        params: { fills: [{ fieldId: "a", value: "x", source: "user" }] },
        bridge: [{ method: "form.fill", error: expect.stringMatching(/timed out/) }],
        error: { message: expect.stringMatching(/timed out/) },
      });
      expect(record.bridge[0].params).not.toHaveProperty("timing");
      const index = JSON.parse((await readFile(join(session, "index.jsonl"), "utf8")).trim());
      expect(index).toMatchObject({ seq: 1, tool: "fill_fields", ok: false, debug: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("records nothing when it's off", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ezapply-debug-"));
    try {
      const f = forms(slowBridge().bridge, workspaceAt(dir));
      await f.listOptions("gender", 7);
      await f.debugIdle();
      await expect(readdir(join(dir, "debug"))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps debug/ under its size, deleting the oldest sessions but never the current one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ezapply-debug-"));
    try {
      for (const name of ["2026-09-01-a", "2026-09-02-b", "2026-09-03-c"]) {
        await mkdir(join(dir, name));
        await writeFile(join(dir, name, "0001-get_form.json"), "x".repeat(1000));
      }
      expect(await pruneDebug(dir, 1500, join(dir, "2026-09-01-a"))).toEqual([
        join(dir, "2026-09-02-b"),
        join(dir, "2026-09-03-c"),
      ]);
      expect(await readdir(dir)).toEqual(["2026-09-01-a"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drops an upload's file contents from the record, keeping its size", () => {
    expect(stripBulk({ fieldId: "f", file: { name: "a.pdf", base64: "AAAA" }, tabId: 7, timing: {} })).toEqual({
      fieldId: "f",
      file: { name: "a.pdf", bytes: 3 },
    });
  });
});

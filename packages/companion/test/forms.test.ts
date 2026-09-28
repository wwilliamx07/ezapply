import type { TabInfo } from "@ezapply/protocol";
import { describe, expect, it } from "vitest";
import type { ExtensionBridge } from "../src/bridge/server.js";
import { FormsService } from "../src/forms/service.js";
import { createLogger } from "../src/logger.js";
import type { PostingsService } from "../src/postings/service.js";

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

function forms(bridge: ExtensionBridge) {
  const postings = { activeId: async () => null } as unknown as PostingsService;
  return new FormsService({} as never, postings, bridge, {} as never, createLogger({ toFile: false, level: "silent" }));
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

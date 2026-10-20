import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type BridgeMessage,
  CompanionApi,
  ExtensionApi,
  type OnboardState,
  type PanelUpdate,
  PROTOCOL_VERSION,
  parseBridgeMessage,
  RpcPeer,
} from "@ezapply/protocol";
import { FORM_SITE_IDS } from "@ezapply/sites";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ClaudeCommand } from "../src/agent/process.js";
import { MemoryStore } from "../src/github/secrets.js";
import { createLogger } from "../src/logger.js";
import { type CompanionHandle, startCompanion } from "../src/main.js";
import { waitFor } from "../src/util/wait.js";

const STUB = join(import.meta.dirname, "claude-stream-stub.mjs");
const PAIRING = "ABCD-EFGH-JKLM-NPQR";
const MCP_TOKEN = "t".repeat(43);
const EXT = "abcdefghijklmnopabcdefghijklmnop";
const POSTING_URL = "https://example-tenant.wd1.myworkdayjobs.com/en-US/careers/job/Remote/Software-Developer_REQ-0001";
const APPLY_URL =
  "https://example-tenant.wd1.myworkdayjobs.com/en-US/careers/job/Remote/Software-Developer_REQ-0001/apply";

let dir: string;
let handle: CompanionHandle;
let opened: string[];
const sockets: WebSocket[] = [];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezapply-panel-"));
  opened = [];
  const claude: ClaudeCommand = { file: process.execPath, args: [STUB], shell: false };
  handle = await startCompanion({
    config: {
      schemaVersion: 1,
      host: "127.0.0.1",
      port: 0,
      mcpToken: MCP_TOKEN,
      pairingToken: PAIRING,
      workspace: join(dir, "ws"),
    },
    log: createLogger({ toFile: false, level: "silent" }),
    appDataDir: join(dir, "app"),
    secrets: new MemoryStore(),
    saveConfig: async () => {},
    opener: {
      file: async (p) => {
        opened.push(p);
        return "default";
      },
      url: async (u) => {
        opened.push(u);
        return "default";
      },
    },
    claude,
    reconnectGraceMs: 0,
  });
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  await handle.close();
  await rm(dir, { recursive: true, force: true });
});

/** The extension as the panel's relay: it calls `panel.*` and records the updates the companion pushes. */
async function extension() {
  const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/bridge`, { origin: `chrome-extension://${EXT}` });
  sockets.push(ws);
  const updates: PanelUpdate[] = [];
  const send = (m: BridgeMessage) => ws.send(JSON.stringify(m));
  const peer = new RpcPeer({
    send,
    remote: CompanionApi,
    local: ExtensionApi,
    handlers: {
      "browser.status": async () => ({ extensionVersion: "9.9.9", tabs: [] }),
      "panel.update": async (u: PanelUpdate) => {
        updates.push(u);
        return {};
      },
    } as never,
  });
  await new Promise<void>((resolve, reject) => {
    ws.on("open", () =>
      send({
        kind: "hello",
        protocolVersion: PROTOCOL_VERSION,
        extensionVersion: "9.9.9",
        pairingToken: PAIRING,
        sites: [...FORM_SITE_IDS],
      }),
    );
    ws.on("message", (data) => {
      const msg = parseBridgeMessage(data.toString());
      if (msg?.kind === "welcome") resolve();
      else if (msg?.kind === "request" || msg?.kind === "response") void peer.handle(msg);
    });
    ws.on("error", reject);
  });
  return { ws, peer, updates };
}

async function capture(url = POSTING_URL, pageTitle = "Software Developer - Example Co"): Promise<string> {
  const r = await handle.services.postings.capture({
    url,
    pageTitle,
    html: "<h1>Software Developer</h1>",
    visibleHtml: "<h1>Software Developer</h1>",
    visibleText: "Software Developer\nExample Co\nWe build things.",
    jsonLd: [],
    capturedAt: "2026-01-01T00:00:00.000Z",
    tabId: 5,
  });
  return r.postingId;
}

describe("the side panel over the bridge", () => {
  it("gives the panel its state and a posting's conversation: requirements, documents, review state", async () => {
    const { peer } = await extension();
    const id = await capture();
    const folder = join(dir, "ws", "postings", id);
    await writeFile(
      join(folder, "notes.md"),
      "## Application requirements\n- **One PDF** with resume and cover letter\n- Cover letter required\n\n## Key terms\n- Go\n",
    );
    const resume = Buffer.from("%PDF-1.4 resume");
    await writeFile(join(folder, "resume.pdf"), resume);
    await writeFile(join(folder, "cover.pdf"), Buffer.from("%PDF-1.4 cover"));
    await writeFile(
      join(folder, "approvals.json"),
      JSON.stringify({
        schemaVersion: 1,
        approvals: {
          "resume.pdf": {
            sha256: createHash("sha256").update(resume).digest("hex"),
            approvedAt: "2026-01-01T00:00:00.000Z",
            reviewId: "r1",
          },
        },
      }),
    );
    await writeFile(
      join(folder, "form-log.jsonl"),
      `${JSON.stringify({ ts: "x", event: "upload", fieldId: "f", file: join(folder, "resume.pdf"), ok: true })}\n`,
    );

    const state = await peer.request("panel.state", {});
    expect(state).toMatchObject({ agent: { status: "idle" }, cards: [] });
    expect(state).not.toHaveProperty("activePostingId");
    expect(state.postings[0]).toMatchObject({ id, site: "workday" });
    expect(state.agent.agents).toEqual(["claude"]);
    expect(state.agent.models).toEqual({});
    // The extension's settings: what conversations run with comes back.
    const choice = { permissionMode: "auto", model: "opus", effort: "medium" } as const;
    expect(await peer.request("panel.settings", { agent: "claude", choices: { claude: choice } })).toEqual({
      agent: "claude",
      ...choice,
    });
    await expect(
      peer.request("panel.settings", {
        agent: "claude",
        choices: { claude: { ...choice, permissionMode: "bypassPermissions" as "plan" } },
      }),
    ).rejects.toThrow();
    const conv = await peer.request("panel.conversation", { key: `${id}/tailor` });
    expect(conv.posting?.requirements).toEqual(["One PDF with resume and cover letter", "Cover letter required"]);
    expect(conv.documents).toEqual([
      { file: "cover.pdf", state: "draft" },
      { file: "resume.pdf", state: "attached" },
    ]);
    expect(conv.events).toEqual([]);
    expect(await peer.request("panel.conversation", { key: "general" })).toMatchObject({
      key: "general",
      documents: [],
    });
    // The application's conversation shows the same posting and documents.
    expect(await peer.request("panel.conversation", { key: `${id}/fill` })).toMatchObject({
      key: `${id}/fill`,
      posting: { id },
      documents: conv.documents,
    });
    await expect(peer.request("panel.conversation", { key: id })).rejects.toThrow(/Not a conversation/);
  });

  it("tells what a tab is to the posting open in the panel", async () => {
    const { peer } = await extension();
    const postingId = await capture();
    const tab = (url: string, site: "workday" | "generic") =>
      peer.request("panel.tab", { tabId: 1, url, title: "", site, postingId });
    // In the general conversation there's no posting to compare with.
    expect(await peer.request("panel.tab", { tabId: 1, url: APPLY_URL, title: "", site: "workday" })).not.toMatchObject(
      {
        kind: "application",
      },
    );
    expect(await tab(POSTING_URL, "workday")).toMatchObject({ kind: "posting" });
    expect(await tab(APPLY_URL, "workday")).toMatchObject({
      kind: "application",
      text: expect.stringContaining("Workday"),
    });
    expect(
      await tab(
        "https://example-tenant.wd1.myworkdayjobs.com/en-US/careers/job/Remote/Other_REQ-0002/apply",
        "workday",
      ),
    ).toMatchObject({
      kind: "other-application",
    });
    expect(await tab("https://example.com/blog", "generic")).toMatchObject({ kind: "page" });
    expect(await tab("chrome://extensions", "generic")).toMatchObject({ kind: "none" });
  });

  it("tells an application embedded in a careers page by its frame", async () => {
    const { peer } = await extension();
    const POSTING = "https://careers.example.com/jobs/software-developer";
    const EMBED = "https://job-boards.greenhouse.io/embed/job_app?for=example&token=1000001";
    const postingId = await capture(POSTING, "Software Developer - Example Co");
    const frames = [{ frameId: 12, url: EMBED, site: "greenhouse" as const }];
    const tab = (url: string, f = frames) =>
      peer.request("panel.tab", { tabId: 1, url, title: "", site: "generic", frames: f, postingId });
    // The careers page's apply page, its form in a Greenhouse frame: an application, not "some page".
    expect(await tab(`${POSTING}/apply`)).toMatchObject({
      kind: "unconfirmed-application",
      text: expect.stringContaining("Greenhouse"),
    });
    // Once bound, it's this posting's.
    await handle.services.postings.setApplication(postingId, {
      url: EMBED,
      site: "greenhouse",
      tenant: "example",
      job: "1000001",
      from: "bound",
      at: "2026-01-01T00:00:00.000Z",
    });
    expect(await tab(`${POSTING}/apply`)).toMatchObject({ kind: "application" });
    // The form embedded in the posting's own page makes that page the application too.
    expect(await tab(POSTING)).toMatchObject({ kind: "application" });
    // Without a frame the posting's page is the posting, and another page is none of its.
    expect(await tab(POSTING, [])).toMatchObject({ kind: "posting" });
    expect(await tab(`${POSTING}/apply`, [])).toMatchObject({ kind: "page" });
  });

  it("tells a posting whose page is its application form as the application (Greenhouse's board)", async () => {
    const { peer } = await extension();
    const BOARD = "https://job-boards.greenhouse.io/example/jobs/1000001";
    const postingId = await capture(BOARD, "Software Developer - Example Co");
    const tab = (url: string) => peer.request("panel.tab", { tabId: 1, url, title: "", site: "greenhouse", postingId });
    expect(await tab(BOARD)).toMatchObject({ kind: "application", text: expect.stringContaining("Greenhouse") });
    expect(await tab("https://job-boards.greenhouse.io/example/jobs/1000002")).toMatchObject({
      kind: "other-application",
    });
    // Workday's posting page still only leads to its form (the test above).
  });

  it("sends a message to a posting's conversation and pushes the agent's events while a panel watches", async () => {
    const ext = await extension();
    const id = await capture();
    const other = await capture(); // same URL: the same posting, still one
    expect(other).toBe(id);
    await ext.peer.request("panel.watch", { open: 1 });
    await ext.peer.request("panel.send", { key: `${id}/tailor`, text: "tailor my resume" });
    await waitFor(async () => (ext.updates.some((u) => u.event?.event.kind === "turnEnd") ? true : null), 10_000);
    const kinds = ext.updates.filter((u) => u.event).map((u) => u.event?.event.kind);
    expect(kinds).toEqual(["user", "user", "text", "turnEnd"]);
    expect(ext.updates.find((u) => u.event?.event.kind === "text")?.event).toMatchObject({
      conversation: `${id}/tailor`,
      event: { text: "echo: tailor my resume" },
    });
    expect(ext.updates.some((u) => u.changed)).toBe(true);
    const conv = await ext.peer.request("panel.conversation", { key: `${id}/tailor` });
    expect(conv.events.map((e) => e.kind)).toEqual(["user", "text", "turnEnd"]);
    expect(conv.totalCostUsd).toBe(0.01);
  });

  it("asks for a notification when a turn ends or a card opens, even with no panel open, unless turned off", async () => {
    const ext = await extension();
    const id = await capture();
    await ext.peer.request("panel.send", { key: `${id}/fill`, text: "fill it" });
    await waitFor(async () => (ext.updates.some((u) => u.notify) ? true : null), 10_000);
    expect(ext.updates.find((u) => u.notify)?.notify).toEqual({
      conversation: `${id}/fill`,
      title: "Claude Code finished",
      message: "Application: Its reply is in the ezapply panel.",
    });
    handle.services.needs.ask({ title: "Step 1", questions: [{ id: "q", prompt: "?", type: "text" }] }, "general");
    await waitFor(async () => (ext.updates.filter((u) => u.notify).length === 2 ? true : null), 5000);
    expect(ext.updates.filter((u) => u.notify).at(-1)?.notify).toMatchObject({
      conversation: "general",
      title: "Claude Code has a question",
      card: true,
    });

    await handle.services.workspace.updateConfig("notifications", { turnEnd: false });
    await ext.peer.request("panel.send", { key: "general", text: "hello" });
    await waitFor(async () => (ext.updates.some((u) => u.cards === 0) ? true : null), 10_000); // the reply settles the card
    handle.services.needs.ask({ title: "Step 2", questions: [{ id: "q", prompt: "?", type: "text" }] }, "general");
    await waitFor(async () => (ext.updates.at(-1)?.cards === 1 ? true : null), 5000);
    expect(ext.updates.filter((u) => u.notify)).toHaveLength(2);
  });

  it("says a turn that ends on an open review waits on it, and leaves a card's notification in place", async () => {
    const ext = await extension();
    const id = await capture();
    await writeFile(join(dir, "ws", "postings", id, "resume.pdf"), "%PDF-1.4 resume v1");
    await handle.services.reviews.open([`postings/${id}/resume.pdf`]);
    await ext.peer.request("panel.send", { key: `${id}/tailor`, text: "tailor it" });
    await waitFor(async () => (ext.updates.some((u) => u.notify) ? true : null), 10_000);
    expect(ext.updates.find((u) => u.notify)?.notify).toEqual({
      conversation: `${id}/tailor`,
      title: "Your documents are ready to review",
      message: "Documents: Approve them or say what to change on the review page.",
    });

    handle.services.needs.ask({ title: "Step 1", questions: [{ id: "q", prompt: "?", type: "text" }] }, "general");
    await ext.peer.request("panel.send", { key: "general", text: "hello" });
    await waitFor(
      async () =>
        ext.updates.some((u) => u.event?.conversation === "general" && u.event.event.kind === "turnEnd") ? true : null,
      10_000,
    );
    expect(ext.updates.filter((u) => u.notify).map((u) => u.notify?.title)).toEqual([
      "Your documents are ready to review",
      "Claude Code has a question",
    ]);
  });

  it("lists the newest postings, and an older one a card waits on", async () => {
    const { peer } = await extension();
    const ids: string[] = [];
    for (let day = 1; day <= 21; day++) {
      const r = await handle.services.postings.capture({
        url: `https://example.com/jobs/${day}`,
        pageTitle: `Job ${day}`,
        html: "<h1>Job</h1>",
        visibleHtml: "<h1>Job</h1>",
        visibleText: "Job",
        jsonLd: [],
        capturedAt: `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`,
        tabId: day,
      });
      ids.push(r.postingId);
    }
    const oldest = ids[0] as string;
    let state = await peer.request("panel.state", {});
    expect(state.postings).toHaveLength(20);
    expect(state.postings.some((p) => p.id === oldest)).toBe(false);
    handle.services.needs.ask(
      { title: "Step 1", questions: [{ id: "q", prompt: "?", type: "text" }] },
      `${oldest}/fill`,
    );
    state = await peer.request("panel.state", {});
    expect(state.postings).toHaveLength(21);
    expect(state.postings.some((p) => p.id === oldest)).toBe(true);
  });

  it("answers cards from the panel, checks the answers, and counts the cards for the badge even with no panel open", async () => {
    const ext = await extension();
    const { needs } = handle.services;
    const card = needs.ask(
      {
        title: "Step 2",
        questions: [{ id: "q", prompt: "Pick", type: "single", options: [{ value: "A" }, { value: "B" }] }],
      },
      "general",
    );
    await waitFor(async () => (ext.updates.some((u) => u.cards === 1) ? true : null), 5000);
    expect(ext.updates.some((u) => u.event || u.changed)).toBe(false); // nothing else while no panel watches
    await expect(ext.peer.request("panel.answer", { cardId: card.id, answers: { q: { value: "C" } } })).rejects.toThrow(
      /isn't one of the options/,
    );
    const waiting = needs.waitAsk(card.id, 5000);
    await ext.peer.request("panel.answer", { cardId: card.id, answers: { q: { value: "B" } } });
    expect(await waiting).toEqual({ answers: { q: { value: "B" } } });

    const decision = needs.permission({ toolName: "Bash", input: { command: "mkdir x" } }, "general");
    const id = needs.list()[0]?.id as string;
    await ext.peer.request("panel.permission", { cardId: id, allow: false, reason: "not now" });
    expect(await decision).toEqual({ behavior: "deny", message: "The user denied this in the ezapply panel: not now" });
    await waitFor(async () => (ext.updates.at(-1)?.cards === 0 ? true : null), 5000);
  });

  it("deletes a document the panel lists, and only that, keeping its source", async () => {
    const { peer } = await extension();
    const id = await capture();
    const folder = join(dir, "ws", "postings", id);
    await writeFile(join(folder, "resume.pdf"), Buffer.from("%PDF-1.4 resume"));
    await writeFile(join(folder, "resume.tex"), "\\documentclass{article}");
    await peer.request("panel.deleteDocument", { postingId: id, file: "resume.pdf" });
    expect(existsSync(join(folder, "resume.pdf"))).toBe(false);
    expect(existsSync(join(folder, "resume.tex"))).toBe(true);
    await expect(peer.request("panel.deleteDocument", { postingId: id, file: "resume.tex" })).rejects.toThrow(
      /No document/,
    );
    await expect(
      peer.request("panel.deleteDocument", { postingId: id, file: "../../profile/profile.yaml" }),
    ).rejects.toThrow(/No document/);
  });

  it("deletes a posting: its folder and conversations go, and it leaves the panel's list", async () => {
    const ext = await extension();
    const id = await capture();
    await ext.peer.request("panel.send", { key: `${id}/fill`, text: "hello" });
    await waitFor(async () => ((await handle.services.agent.history(`${id}/fill`)).length >= 3 ? true : null), 10_000);
    await ext.peer.request("panel.deletePosting", { postingId: id });
    expect(existsSync(join(dir, "ws", "postings", id))).toBe(false);
    expect(existsSync(join(dir, "ws", "agent", id))).toBe(false);
    expect(await handle.services.agent.history(`${id}/fill`)).toEqual([]);
    const state = await ext.peer.request("panel.state", {});
    expect(state.postings).toEqual([]);
    await expect(ext.peer.request("panel.deletePosting", { postingId: id })).rejects.toThrow(/No posting/);
  });

  it("marks a posting submitted for the user, and logs it", async () => {
    const { peer } = await extension();
    const id = await capture();
    await peer.request("panel.markSubmitted", { postingId: id });
    const state = await peer.request("panel.state", {});
    expect(state.postings.find((p) => p.id === id)?.status).toBe("submitted");
    const log = await readFile(join(dir, "ws", "postings", id, "form-log.jsonl"), "utf8");
    expect(JSON.parse(log.trim())).toMatchObject({ event: "marked-submitted" });
  });

  it("opens the setup page and a posting's file for the user, and refuses a file outside the posting", async () => {
    const { peer } = await extension();
    const id = await capture();
    await peer.request("panel.open", { what: "setup" });
    expect(opened.at(-1)).toMatch(/\/onboard\?t=/);
    await mkdir(join(dir, "ws", "postings", id), { recursive: true });
    await peer.request("panel.open", { what: "file", postingId: id, file: "posting.md" });
    expect(opened.at(-1)).toBe(join(dir, "ws", "postings", id, "posting.md"));
    await expect(
      peer.request("panel.open", { what: "file", postingId: id, file: "../../profile/profile.yaml" }),
    ).rejects.toThrow(/outside the allowed folders/);
  });

  it("stops showing cards when the extension disconnects, so a terminal chat asks in chat again", async () => {
    const ext = await extension();
    await ext.peer.request("panel.watch", { open: 2 });
    expect(handle.services.needs.watched).toBe(true);
    ext.ws.close();
    await waitFor(async () => (handle.services.needs.watched ? null : true), 5000);
    expect(handle.services.needs.watched).toBe(false);
  });
});

describe("setup tasks for the panel's agent", () => {
  it("sends a task from the setup page to the general conversation, and takes its report without waiting", async () => {
    const { url } = handle.services.onboarding.open();
    const u = new URL(url);
    const res = await fetch(`${u.origin}/onboard/action?t=${u.searchParams.get("t")}`, {
      method: "POST",
      headers: { Origin: u.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "task", kind: "question", params: { text: "What does ezapply do?" } }),
    });
    const { task } = (await res.json()) as { task: { id: string } };
    const events: string[] = [];
    handle.services.agent.onEvent((k, e) => {
      if (k === "general" && e.kind === "text") events.push(e.text);
    });
    await waitFor(async () => (events.length > 0 ? true : null), 10_000);
    expect(events[0]).toMatch(/^echo: Setup task t1 from the setup page \(question\)/);
    expect(events[0]).toContain('onboarding { taskId: "t1", result: { ok, note? } }');

    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${MCP_TOKEN}` } },
      }),
    );
    const r = await client.callTool({
      name: "onboarding",
      arguments: { taskId: task.id, result: { ok: true, note: "Answered." } },
    });
    expect(JSON.parse((r.content as { text: string }[])[0]?.text ?? "null")).toEqual({ reported: true });
    const state = await (await fetch(`${u.origin}/onboard/state?t=${u.searchParams.get("t")}`)).json();
    expect(state).toMatchObject({
      agentIn: "panel",
      agentListening: true,
      tasks: [{ id: "t1", status: "done", note: "Answered." }],
    });
    await client.close();
  });

  it("fails a setup task whose turn the user stops, so the page stops waiting on it", async () => {
    const { url } = handle.services.onboarding.open();
    const u = new URL(url);
    const t = u.searchParams.get("t");
    await fetch(`${u.origin}/onboard/action?t=${t}`, {
      method: "POST",
      headers: { Origin: u.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "task", kind: "question", params: { text: "[slow]" } }),
    });
    const stateOf = async () => (await (await fetch(`${u.origin}/onboard/state?t=${t}`)).json()) as OnboardState;
    expect((await stateOf()).agentName).toBe("Claude Code");
    await waitFor(async () => (handle.services.agent.statusOf("general") === "working" ? true : null), 10_000);
    expect((await stateOf()).tasks).toMatchObject([{ id: "t1", status: "running" }]);
    expect(handle.services.agent.stop("general")).toBe(true);
    const task = await waitFor(async () => {
      const [t1] = (await stateOf()).tasks;
      return t1?.status === "failed" ? t1 : null;
    }, 10_000);
    expect(task?.note).toMatch(/^Stopped before it finished/);
  });
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../src/github/secrets.js";
import { createLogger } from "../src/logger.js";
import { type CompanionHandle, startCompanion } from "../src/main.js";
import { skipReason } from "../src/onboarding/service.js";
import { formatPreferences, parsePreferences } from "../src/profile/service.js";

const MCP_TOKEN = "t".repeat(43);
let dir: string;
let ws: string;
let handle: CompanionHandle;
let opened: string[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezapply-onboard-"));
  ws = join(dir, "ws");
  await mkdir(ws, { recursive: true });
  opened = [];
  handle = await startCompanion({
    config: {
      schemaVersion: 1,
      host: "127.0.0.1",
      port: 0,
      mcpToken: MCP_TOKEN,
      pairingToken: "ABCD-EFGH-JKLM-NPQR",
      workspace: ws,
    },
    log: createLogger({ toFile: false, level: "silent" }),
    appDataDir: join(dir, "app"),
    secrets: new MemoryStore(),
    saveConfig: async () => {},
    opener: {
      file: async () => "default",
      url: async (u) => {
        opened.push(u);
        return "default";
      },
    },
  });
});

afterEach(async () => {
  await handle.close();
  await rm(dir, { recursive: true, force: true });
});

async function mcp(): Promise<Client> {
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${MCP_TOKEN}` } },
    }),
  );
  return client;
}

async function call(client: Client, args: Record<string, unknown>) {
  // Without a panel agent, the agent waits in the call for the page's tasks.
  const res = await client.callTool({ name: "onboarding", arguments: { wait: true, ...args } });
  return JSON.parse((res.content as { text: string }[])[0]?.text ?? "null");
}

/** The page, as a browser holding its cookie: GETs and POSTs from the companion's own origin. */
function page(url: string) {
  const u = new URL(url);
  const cookie = `ezapply_page=${u.searchParams.get("t")}`;
  const headers = { Cookie: cookie, Origin: u.origin };
  return {
    get: (path: string) => fetch(`${u.origin}/onboard/${path}`, { headers }),
    act: (body: Record<string, unknown>) =>
      fetch(`${u.origin}/onboard/action`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    upload: (name: string, bytes: string) =>
      fetch(`${u.origin}/onboard/library?name=${encodeURIComponent(name)}`, { method: "POST", headers, body: bytes }),
    state: async () => (await fetch(`${u.origin}/onboard/state`, { headers })).json(),
  };
}

async function until<T>(probe: () => T | undefined, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = probe();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("onboarding on a page", () => {
  it("opens the page, hands the agent the page's tasks one at a time, and ends when the user finishes", async () => {
    const client = await mcp();
    const waiting = call(client, { timeoutSeconds: 30 });
    const url = await until(() => opened[0]);
    const p = page(url);

    // The page: the UI package's, its token traded for a cookie on its own path.
    const shell = await fetch(url);
    expect(shell.headers.get("set-cookie")).toMatch(/^ezapply_page=[\w-]+; Path=\/onboard; HttpOnly; SameSite=Strict$/);
    expect(await shell.text()).toMatch(/<script type="module" src="\/ui\/onboard-/);
    // Without the cookie, or from another origin, nothing.
    expect((await fetch(`${new URL(url).origin}/onboard/state`)).status).toBe(404);
    const elsewhere = await fetch(`${new URL(url).origin}/onboard/action`, {
      method: "POST",
      headers: { Cookie: `ezapply_page=${new URL(url).searchParams.get("t")}`, Origin: "https://evil.example" },
      body: JSON.stringify({ action: "finish" }),
    });
    expect(elsewhere.status).toBe(403);

    // The page listens for changes; while it does, it counts as open and isn't opened again.
    const events = await p.get("events");
    expect(events.headers.get("content-type")).toMatch(/text\/event-stream/);
    const state = await p.state();
    expect(state).toMatchObject({ status: "open", ready: false, agentListening: true });
    expect(state.steps.map((s: { id: string }) => s.id)).toEqual([
      "tex",
      "extension",
      "github",
      "repos",
      "knowledge",
      "resume",
      "profile",
      "cover",
      "answers",
      "preferences",
      "library",
    ]);
    expect((await p.act({ action: "task", kind: "nonsense" })).status).toBe(400);

    // Two tasks, taken in order; the first comes back to the waiting call with what to do.
    await p.act({ action: "task", kind: "question", params: { text: "What do you read?" } });
    await p.act({ action: "task", kind: "index-repos", params: { repos: ["jane/api"] } });
    const first = await waiting;
    expect(first).toMatchObject({
      url,
      openedIn: "default",
      task: { id: "t1", kind: "question", params: { text: "What do you read?" }, status: "running" },
    });
    expect(first.task.how).toMatch(/note/);
    // Reporting waits for the next in the same call; the page shows the note.
    const second = await call(client, { taskId: "t1", result: { ok: true, note: "Only what you choose." } });
    expect(second.task).toMatchObject({ id: "t2", kind: "index-repos" });
    expect(second.openedIn).toBeUndefined();
    expect((await p.state()).tasks).toMatchObject([
      { id: "t1", status: "done", note: "Only what you choose." },
      { id: "t2", status: "running" },
    ]);
    // A task taken and never reported is given again.
    expect((await call(client, { timeoutSeconds: 5 })).task).toMatchObject({ id: "t2" });
    expect((await call(client, { taskId: "nope", timeoutSeconds: 5 })).error).toMatchObject({ code: "not_found" });

    // Nothing more: the call says to wait again.
    const idle = await call(client, { taskId: "t2", result: { ok: false, note: "No access." }, timeoutSeconds: 5 });
    expect(idle).toMatchObject({ waiting: true, hint: expect.stringMatching(/onboarding \{ wait: true \}/) });

    const done = call(client, { timeoutSeconds: 30 });
    await new Promise((r) => setTimeout(r, 100));
    expect((await p.act({ action: "finish" })).status).toBe(200);
    expect(await done).toMatchObject({
      done: true,
      ready: false,
      notDone: expect.arrayContaining([expect.stringMatching(/^tex|^extension/)]),
    });
    expect((await p.state()).status).toBe("finished");
    // Asking again reopens it.
    const again = call(client, { timeoutSeconds: 5 });
    expect(await again).toMatchObject({ waiting: true });
    expect((await p.state()).status).toBe("open");
    expect(opened).toHaveLength(1);
    await events.body?.cancel();
    await client.close();
  });

  it("gives the link instead of waiting when no browser opened", async () => {
    await handle.close();
    handle = await startCompanion({
      config: {
        schemaVersion: 1,
        host: "127.0.0.1",
        port: 0,
        mcpToken: MCP_TOKEN,
        pairingToken: "ABCD-EFGH-JKLM-NPQR",
        workspace: ws,
      },
      log: createLogger({ toFile: false, level: "silent" }),
      appDataDir: join(dir, "app"),
      secrets: new MemoryStore(),
      saveConfig: async () => {},
      // No browser to open the page in: the opener throws.
      opener: {
        file: async () => "default",
        url: async () => {
          throw new Error("no browser");
        },
      },
    });
    const client = await mcp();
    const r = await call(client, {});
    expect(r).toMatchObject({
      openedBrowser: false,
      tell: expect.stringContaining(r.url),
      hint: "Then wait for its tasks: onboarding { wait: true }.",
    });
    await client.close();
  });

  it("writes the profile from the form in place: comments and the user's own keys stay, cleared fields go", async () => {
    await mkdir(join(ws, "profile"), { recursive: true });
    await writeFile(
      join(ws, "profile", "profile.yaml"),
      `# My profile
schemaVersion: 1
identity:
  firstName: Jane # as on my passport
  lastName: Doe
  pronouns: she/her
contact:
  email: jane@example.com
  fax: "555" # mine, not ezapply's
  address:
    city: Toronto
    country: Canada
hobbies: [chess]
`,
    );
    const p = page(handle.services.onboarding.open().url);
    const value = {
      identity: { firstName: "Jane", lastName: "Doe", pronouns: "" },
      contact: {
        email: "jane@example.com",
        phone: { countryCode: "+1", number: "555 0100", type: "mobile" },
        address: { city: "Toronto", region: "ON", country: "Canada" },
      },
      work: [
        { company: "Example Systems", title: "Engineer", start: "2022-01", end: null, highlights: ["Led a team."] },
      ],
    };
    expect(await (await p.act({ action: "profile", value })).json()).toEqual({ ok: true });
    const text = await readFile(join(ws, "profile", "profile.yaml"), "utf8");
    expect(text).toContain("# My profile");
    expect(text).toContain("firstName: Jane # as on my passport");
    expect(text).toContain('fax: "555" # mine, not ezapply\'s');
    expect(text).toContain("hobbies: [ chess ]");
    expect(text).not.toContain("pronouns");
    expect(text).toContain("region: ON");
    expect(text).toContain("company: Example Systems");
    // What the schema refuses isn't written, and comes back by field.
    const bad = await (
      await p.act({ action: "profile", value: { ...value, contact: { ...value.contact, email: "not an email" } } })
    ).json();
    expect(bad).toMatchObject({ ok: false, errors: [{ path: "contact.email" }] });
    expect(await readFile(join(ws, "profile", "profile.yaml"), "utf8")).toBe(text);
    // The page reads it back as data.
    expect((await p.state()).profile).toMatchObject({ exists: true, valid: true, value: { hobbies: ["chess"] } });
  });

  it("sets screening answers in place and keeps the bank's comments", async () => {
    const p = page(handle.services.onboarding.open().url);
    const before = await readFile(join(ws, "profile", "answers.yaml"), "utf8");
    const { unanswered } = (await p.state()).answers;
    const [a, b] = unanswered as { id: string }[];
    const r = await (
      await p.act({
        action: "answers",
        answers: { [a?.id as string]: "Yes", [b?.id as string]: null, unknown_id: "x" },
      })
    ).json();
    expect(r).toEqual({ ok: true, set: [a?.id, b?.id] });
    const after = await readFile(join(ws, "profile", "answers.yaml"), "utf8");
    expect(after.split("\n").slice(0, 6)).toEqual(before.split("\n").slice(0, 6));
    expect((await p.state()).answers.unanswered.map((q: { id: string }) => q.id)).not.toContain(a?.id);
  });

  it("saves preferences under fixed headings, keeping what else the file held, and the attach mode", async () => {
    await mkdir(join(ws, "profile"), { recursive: true });
    await writeFile(join(ws, "profile", "preferences.md"), "# Preferences\n\n## Tone\n\nPlain.\n\n## Pets\n\nA cat.\n");
    const p = page(handle.services.onboarding.open().url);
    expect((await p.state()).preferences).toMatchObject({ tone: "Plain.", attachMode: "after-approval" });
    const prefs = {
      tone: "Warm.",
      emphasis: "Backend.",
      neverMention: "",
      targets: "Remote.",
      coverLetters: "Always.",
    };
    await p.act({ action: "preferences", attachMode: "immediately", ...prefs });
    const md = await readFile(join(ws, "profile", "preferences.md"), "utf8");
    expect(md).toBe(
      "# Preferences\n\n## Tone\n\nWarm.\n\n## What to emphasize\n\nBackend.\n\n## Target roles and locations\n\nRemote.\n\n## Cover letters\n\nAlways.\n\n## Pets\n\nA cat.\n",
    );
    expect((await p.state()).preferences).toMatchObject({ ...prefs, attachMode: "immediately" });
    expect(parsePreferences(formatPreferences({ ...prefs, neverMention: "Visa." }))).toMatchObject({
      neverMention: "Visa.",
      extra: "",
    });
  });

  it("saves dropped files into library/ under their own names, never over another, and refuses others", async () => {
    const p = page(handle.services.onboarding.open().url);
    expect(await (await p.upload("transcript.pdf", "%PDF-1.4 a")).json()).toEqual({ saved: "library/transcript.pdf" });
    expect(await (await p.upload("../transcript.pdf", "%PDF-1.4 b")).json()).toEqual({
      saved: "library/transcript-2.pdf",
    });
    expect(await readFile(join(ws, "library", "transcript.pdf"), "utf8")).toBe("%PDF-1.4 a");
    expect((await p.upload("run.exe", "MZ")).status).toBe(400);
    expect((await p.state()).library).toEqual(["transcript-2.pdf", "transcript.pdf"]);
    // The page's PDF route serves templates' PDFs only.
    expect((await p.get("file?path=library/transcript.pdf")).status).toBe(400);
  });

  it("deletes a library file the step lists, and nothing outside library/", async () => {
    const p = page(handle.services.onboarding.open().url);
    await p.upload("transcript.pdf", "%PDF-1.4 a");
    await writeFile(join(ws, "profile-copy.yaml"), "name: x");
    expect(await (await p.act({ action: "deleteLibrary", name: "transcript.pdf" })).json()).toEqual({
      deleted: "library/transcript.pdf",
    });
    expect((await p.state()).library).toEqual([]);
    expect((await p.act({ action: "deleteLibrary", name: "transcript.pdf" })).status).toBe(400);
    expect((await p.act({ action: "deleteLibrary", name: "../profile-copy.yaml" })).status).toBe(400);
    expect(await readFile(join(ws, "profile-copy.yaml"), "utf8")).toBe("name: x");
  });

  it("suggests repos by the rules that need no judgment", () => {
    const repo = (fullName: string, extra: Record<string, unknown> = {}) => ({
      fullName,
      private: false,
      fork: false,
      archived: false,
      language: "Go",
      sizeKb: 500,
      pushedAt: null,
      description: null,
      stars: 0,
      defaultBranch: "main",
      ...extra,
    });
    expect(skipReason(repo("jane/api"), "jane")).toBeUndefined();
    expect(skipReason(repo("jane/api", { fork: true }))).toBe("a fork");
    expect(skipReason(repo("jane/api", { archived: true }))).toBe("archived");
    expect(skipReason(repo("jane/api", { sizeKb: 3 }))).toBe("nearly empty");
    expect(skipReason(repo("jane/jane"), "jane")).toBe("profile README");
    expect(skipReason(repo("jane/dotfiles"))).toBe("dotfiles or config");
  });
});

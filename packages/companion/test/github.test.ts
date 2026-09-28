import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../src/github/secrets.js";
import { appSlugFrom } from "../src/github/service.js";
import { createLogger } from "../src/logger.js";
import { type CompanionHandle, startCompanion } from "../src/main.js";

/** A client secret the user generated for an app they already had (GitHub's are 40 hex characters). */
const REUSE_SECRET = "0123456789abcdef0123456789abcdef01234567";

/** Minimal stand-in for github.com + api.github.com. */
function mockGitHub() {
  const calls: string[] = [];
  const usedRefreshTokens = new Set<string>();
  let tokenCounter = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    let body = "";
    for await (const chunk of req) body += chunk;
    calls.push(`${req.method} ${url.pathname}`);
    const json = (status: number, data: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(data));
    };
    const auth = req.headers.authorization ?? "";

    if (req.method === "POST" && url.pathname === "/app-manifests/good-code/conversions") {
      return json(201, {
        id: 42,
        slug: "ezapply-test",
        client_id: "Iv1.client",
        client_secret: "shh",
        html_url: "https://github.com/apps/ezapply-test",
        pem: "-----BEGIN RSA PRIVATE KEY-----",
        owner: { login: "jane" },
      });
    }
    if (req.method === "POST" && url.pathname === "/login/oauth/access_token") {
      const p = JSON.parse(body) as Record<string, string>;
      if (p.client_secret !== "shh" && p.client_secret !== REUSE_SECRET) {
        return json(200, { error: "incorrect_client_credentials" });
      }
      // Refresh tokens are single-use, like GitHub's.
      if (p.grant_type === "refresh_token") {
        if (usedRefreshTokens.has(p.refresh_token ?? "")) return json(200, { error: "bad_refresh_token" });
        usedRefreshTokens.add(p.refresh_token ?? "");
        await new Promise((r) => setTimeout(r, 50)); // a real round trip, so concurrent callers overlap
      }
      if (p.code === "oauth-code" || p.grant_type === "refresh_token") {
        tokenCounter++;
        return json(200, {
          access_token: `ghu_token${tokenCounter}`,
          expires_in: 28800,
          refresh_token: `ghr_refresh${tokenCounter}`,
          refresh_token_expires_in: 15897600,
        });
      }
      return json(200, { error: "bad_verification_code" });
    }
    if (!auth.startsWith("Bearer ghu_")) return json(401, { message: "Bad credentials" });
    if (url.pathname === "/user") return json(200, { login: "jane", name: "Jane Doe", id: 7 });
    if (url.pathname === "/user/installations") {
      return json(200, { installations: [{ id: 1, app_id: 42, app_slug: "ezapply-test" }] });
    }
    if (url.pathname === "/user/installations/1/repositories") {
      const page = url.searchParams.get("page") ?? "1";
      const repo = (n: string, pushed: string) => ({
        full_name: `jane/${n}`,
        private: n === "secret",
        fork: false,
        archived: false,
        language: "TypeScript",
        size: 120,
        pushed_at: pushed,
        description: null,
        stargazers_count: 1,
        default_branch: "main",
      });
      if (page === "1") {
        const next = `<${`http://127.0.0.1:${(server.address() as AddressInfo).port}`}/user/installations/1/repositories?per_page=100&page=2>; rel="next"`;
        return json(200, { repositories: [repo("old", "2024-01-01T00:00:00Z")] }, { link: next });
      }
      return json(200, { repositories: [repo("secret", "2026-09-01T00:00:00Z")] });
    }
    return json(404, { message: "not found" });
  });
  return { server, calls };
}

let dir: string;
let gh: ReturnType<typeof mockGitHub>;
let ghBase: string;
let handle: CompanionHandle;
let secrets: MemoryStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ezapply-gh-"));
  gh = mockGitHub();
  await new Promise<void>((r) => gh.server.listen(0, "127.0.0.1", () => r()));
  ghBase = `http://127.0.0.1:${(gh.server.address() as AddressInfo).port}`;
  secrets = new MemoryStore();
  handle = await startCompanion({
    config: {
      schemaVersion: 1,
      host: "127.0.0.1",
      port: 0,
      mcpToken: "t".repeat(43),
      pairingToken: "ABCD-EFGH-JKLM-NPQR",
      workspace: join(dir, "ws"),
    },
    log: createLogger({ toFile: false, level: "silent" }),
    appDataDir: join(dir, "app"),
    secrets,
    saveConfig: async () => {},
    github: { webBase: ghBase, apiBase: ghBase },
  });
});

afterEach(async () => {
  await handle.close();
  await new Promise<void>((r) => gh.server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

const local = (path: string) => fetch(`http://127.0.0.1:${handle.port}${path}`, { redirect: "manual" });
const stateOf = (location: string) => new URL(location).searchParams.get("state") ?? "";

describe("GitHub app setup and login", () => {
  it("creates the app from a manifest, installs, and logs in", async () => {
    const svc = handle.services.github;
    expect(await svc.status()).toMatchObject({ appRegistered: false, loggedIn: false });

    const start = new URL(svc.loginUrl());
    const page = await local(start.pathname + start.search);
    expect(page.status).toBe(200);
    const html = await page.text();
    const action = html.match(/action="([^"]+)"/)?.[1]?.replace(/&amp;/g, "&") ?? "";
    expect(action).toContain(`${ghBase}/settings/apps/new?state=`);
    const manifest = JSON.parse(
      (html.match(/name="manifest" value="([^"]+)"/)?.[1] ?? "{}").replace(/&quot;/g, '"').replace(/&amp;/g, "&"),
    );
    expect(manifest.default_permissions).toEqual({ contents: "read", metadata: "read" });
    expect(manifest.public).toBe(false);

    // The start link is single use.
    expect((await local(start.pathname + start.search)).status).toBe(400);

    const created = await local(`/github/app-created?code=good-code&state=${stateOf(action)}`);
    expect(created.status).toBe(302);
    expect(created.headers.get("location")).toBe(`${ghBase}/apps/ezapply-test/installations/new`);
    expect(await secrets.get("github-app-client-secret")).toBe("shh");

    const installed = await local("/github/installed?installation_id=1&setup_action=install");
    expect(installed.status).toBe(302);
    const authorize = installed.headers.get("location") ?? "";
    expect(authorize).toContain(`${ghBase}/login/oauth/authorize?client_id=Iv1.client`);

    const waiting = svc.waitForLogin(5_000);
    const cb = await local(`/github/callback?code=oauth-code&state=${stateOf(authorize)}`);
    expect(cb.status).toBe(200);
    expect(await waiting).toMatchObject({ loggedIn: true, login: "jane", appSlug: "ezapply-test" });

    // Replaying the callback fails: states are one-time.
    expect((await local(`/github/callback?code=oauth-code&state=${stateOf(authorize)}`)).status).toBe(400);

    const repos = await svc.listRepos();
    expect(repos.map((r) => r.fullName)).toEqual(["jane/secret", "jane/old"]);
    expect(await svc.gitAuthHeader()).toMatch(/^Authorization: Basic /);
  });

  it("connects an existing app from its Client ID and a new secret, entered on ezapply's page", async () => {
    const svc = handle.services.github;
    const start = new URL(svc.loginUrl("existing"));
    const form = await local(start.pathname + start.search);
    expect(form.status).toBe(200);
    const html = await form.text();
    expect(html).toContain(`${ghBase}/settings/apps`);
    expect(html).toContain(svc.callbackUrl());
    expect(form.headers.get("content-security-policy")).toContain("form-action 'self'");
    const state = html.match(/name="state" value="([^"]+)"/)?.[1] ?? "";

    const submit = (fields: Record<string, string>) =>
      fetch(`http://127.0.0.1:${handle.port}/github/reuse`, {
        method: "POST",
        body: new URLSearchParams(fields),
        redirect: "manual",
      });
    // Nothing is accepted without the page's one-time state.
    expect(
      (await submit({ state: "forged", app: "ezapply-test", client_id: "Iv1.client", client_secret: REUSE_SECRET }))
        .status,
    ).toBe(400);

    const sent = await submit({
      state,
      app: "https://github.com/settings/apps/ezapply-test",
      client_id: "Iv1.client",
      client_secret: REUSE_SECRET,
    });
    expect(sent.status).toBe(302);
    const authorize = sent.headers.get("location") ?? "";
    expect(authorize).toContain(`${ghBase}/login/oauth/authorize?client_id=Iv1.client`);
    // Until the login works, nothing is stored.
    expect(await svc.status()).toMatchObject({ appRegistered: false, loggedIn: false });
    expect(await secrets.get("github-app-client-secret")).toBeNull();

    const waiting = svc.waitForLogin(5_000);
    const cb = await local(`/github/callback?code=oauth-code&state=${stateOf(authorize)}`);
    expect(cb.status).toBe(200);
    expect(await waiting).toMatchObject({
      loggedIn: true,
      login: "jane",
      appRegistered: true,
      appSlug: "ezapply-test",
    });
    expect(await secrets.get("github-app-client-secret")).toBe(REUSE_SECRET);
    const { readFile } = await import("node:fs/promises");
    expect(JSON.parse(await readFile(join(dir, "app", "github-app.json"), "utf8"))).toMatchObject({
      appId: 42,
      slug: "ezapply-test",
      clientId: "Iv1.client",
      origin: "reused",
      localBaseUrl: `http://127.0.0.1:${handle.port}`,
    });
    expect((await svc.listRepos()).map((r) => r.fullName)).toContain("jane/secret");
  });

  it("keeps the current app when an existing app's credentials don't work", async () => {
    await registerApp();
    const svc = handle.services.github;
    const start = new URL(svc.loginUrl("existing"));
    const html = await (await local(start.pathname + start.search)).text();
    const state = html.match(/name="state" value="([^"]+)"/)?.[1] ?? "";

    // A malformed secret: the form comes back with the problem and a fresh state.
    const retry = await fetch(`http://127.0.0.1:${handle.port}/github/reuse`, {
      method: "POST",
      body: new URLSearchParams({ state, app: "ezapply-other", client_id: "Iv1.other00", client_secret: "short" }),
      redirect: "manual",
    });
    expect(retry.status).toBe(400);
    const again = await retry.text();
    expect(again).toMatch(/look like a client secret/);
    expect(again).not.toContain("short");
    const state2 = again.match(/name="state" value="([^"]+)"/)?.[1] ?? "";

    const sent = await fetch(`http://127.0.0.1:${handle.port}/github/reuse`, {
      method: "POST",
      body: new URLSearchParams({
        state: state2,
        app: "ezapply-other",
        client_id: "Iv1.other00",
        client_secret: "f".repeat(40),
      }),
      redirect: "manual",
    });
    const authorize = sent.headers.get("location") ?? "";
    const cb = await local(`/github/callback?code=oauth-code&state=${stateOf(authorize)}`);
    expect(cb.status).toBe(400);
    expect(await cb.text()).toMatch(/incorrect_client_credentials.*same app/s);
    expect(await secrets.get("github-app-client-secret")).toBe("shh");
    expect(await svc.status()).toMatchObject({ appSlug: "ezapply-test" });
  });

  it("reads an app's name from what the user pastes", () => {
    expect(appSlugFrom("ezapply-1a2b3c4d")).toBe("ezapply-1a2b3c4d");
    expect(appSlugFrom(" https://github.com/settings/apps/Ezapply-1A2B ")).toBe("ezapply-1a2b");
    expect(appSlugFrom("https://github.com/apps/ezapply-9f/installations/new")).toBe("ezapply-9f");
    expect(appSlugFrom("../../etc")).toBeUndefined();
    expect(appSlugFrom("")).toBeUndefined();
  });

  it("rejects callbacks without a state it issued", async () => {
    const r = await local("/github/callback?code=oauth-code&state=forged");
    expect(r.status).toBe(400);
    expect(await handle.services.github.status()).toMatchObject({ loggedIn: false });
  });

  it("refreshes an access token that is about to expire", async () => {
    await secrets.set("github-app-client-secret", "shh");
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "app"), { recursive: true });
    await writeFile(
      join(dir, "app", "github-app.json"),
      JSON.stringify({
        schemaVersion: 1,
        appId: 42,
        slug: "ezapply-test",
        clientId: "Iv1.client",
        htmlUrl: "x",
        createdAt: "2026-01-01",
      }),
    );
    await secrets.set(
      "github-user-token",
      JSON.stringify({
        accessToken: "ghu_old",
        expiresAt: Date.now() + 60_000,
        refreshToken: "ghr_x",
        refreshExpiresAt: Date.now() + 1e9,
        login: "jane",
        name: null,
        userId: 7,
      }),
    );
    expect(await handle.services.github.token()).toBe("ghu_token1");
    expect(JSON.parse((await secrets.get("github-user-token")) ?? "{}").accessToken).toBe("ghu_token1");
  });

  it("refreshes once when parallel calls find the token about to expire", async () => {
    await registerApp();
    await expiringToken();
    const tokens = await Promise.all([1, 2, 3, 4].map(() => handle.services.github.token()));
    expect(new Set(tokens)).toEqual(new Set(["ghu_token1"]));
    expect(gh.calls.filter((c) => c === "POST /login/oauth/access_token")).toHaveLength(1);
    expect(await handle.services.github.status()).toMatchObject({ loggedIn: true });
  });

  it("treats an unreadable stored token as logged out instead of failing", async () => {
    await secrets.set("github-user-token", "{not json");
    expect(await handle.services.github.status()).toMatchObject({ loggedIn: false });
    await expect(handle.services.github.token()).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("notices when the app's callback URLs point at another port", async () => {
    await registerApp({ localBaseUrl: "http://127.0.0.1:1234" });
    const status = await handle.services.github.status();
    expect(status.portMismatch).toMatchObject({
      appUrl: "http://127.0.0.1:1234",
      localUrl: `http://127.0.0.1:${handle.port}`,
      hint: expect.stringMatching(/ezapply init --port 1234/),
    });
  });
});

async function registerApp(extra: Record<string, unknown> = {}) {
  const { writeFile, mkdir } = await import("node:fs/promises");
  await secrets.set("github-app-client-secret", "shh");
  await mkdir(join(dir, "app"), { recursive: true });
  await writeFile(
    join(dir, "app", "github-app.json"),
    JSON.stringify({
      schemaVersion: 1,
      appId: 42,
      slug: "ezapply-test",
      clientId: "Iv1.client",
      htmlUrl: "x",
      createdAt: "2026-01-01",
      ...extra,
    }),
  );
}

async function expiringToken() {
  await secrets.set(
    "github-user-token",
    JSON.stringify({
      accessToken: "ghu_old",
      expiresAt: Date.now() + 60_000,
      refreshToken: "ghr_x",
      refreshExpiresAt: Date.now() + 1e9,
      login: "jane",
      name: null,
      userId: 7,
    }),
  );
}

export type { Server };

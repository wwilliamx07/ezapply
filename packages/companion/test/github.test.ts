import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../src/github/secrets.js";
import { createLogger } from "../src/logger.js";
import { type CompanionHandle, startCompanion } from "../src/main.js";

/** Minimal stand-in for github.com + api.github.com. */
function mockGitHub() {
  const calls: string[] = [];
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
      if (p.client_secret !== "shh") return json(401, { error: "bad_client" });
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
    if (url.pathname === "/user/installations") return json(200, { installations: [{ id: 1 }] });
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
});

export type { Server };

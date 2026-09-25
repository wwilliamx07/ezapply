import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { z } from "zod";
import type { Logger } from "../logger.js";
import { readJson, writeJsonAtomic } from "../workspace/workspace.js";
import type { SecretStore } from "./secrets.js";

/**
 * GitHub access through a per-user GitHub App with read-only permissions.
 *
 * Setup (once): the daemon serves a page that posts an App Manifest to GitHub; the user clicks
 * "Create", GitHub redirects back with a code we convert into app credentials, then the user installs
 * the app on the repos they choose. Login: standard OAuth web flow against the app, with the
 * callback on this daemon. Every browser-facing step is guarded by a one-time state value.
 */

const AppFile = z.object({
  schemaVersion: z.literal(1),
  appId: z.number(),
  slug: z.string(),
  clientId: z.string(),
  htmlUrl: z.string(),
  owner: z.string().optional(),
  createdAt: z.string(),
});
type AppFile = z.infer<typeof AppFile>;

const TokenBlob = z.object({
  accessToken: z.string(),
  expiresAt: z.number().nullable(),
  refreshToken: z.string().nullable(),
  refreshExpiresAt: z.number().nullable(),
  login: z.string(),
  name: z.string().nullable(),
  userId: z.number(),
});
type TokenBlob = z.infer<typeof TokenBlob>;

const SECRET_CLIENT = "github-app-client-secret";
const SECRET_TOKEN = "github-user-token";
const STATE_TTL_MS = 30 * 60 * 1000;
const API_VERSION = "2022-11-28";

export interface GitHubStatus {
  appRegistered: boolean;
  appSlug?: string;
  manageUrl?: string;
  loggedIn: boolean;
  login?: string;
  name?: string;
  tokenExpiresAt?: string;
}

export interface RepoInfo {
  fullName: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  language: string | null;
  sizeKb: number;
  pushedAt: string | null;
  description: string | null;
  stars: number;
  defaultBranch: string;
}

export interface GitHubOptions {
  secrets: SecretStore;
  appFilePath: string;
  /** http://127.0.0.1:<port>: known only after the server listens. */
  localBaseUrl: () => string;
  log: Logger;
  webBase?: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

type Pending = { purpose: "start" | "manifest" | "install" | "oauth"; expires: number };

export class GitHubService {
  private readonly webBase: string;
  private readonly apiBase: string;
  private readonly fetch: typeof fetch;
  private readonly states = new Map<string, Pending>();
  private loginWaiters: (() => void)[] = [];

  constructor(private readonly opts: GitHubOptions) {
    this.webBase = opts.webBase ?? "https://github.com";
    this.apiBase = opts.apiBase ?? "https://api.github.com";
    this.fetch = opts.fetchImpl ?? fetch;
  }

  async status(): Promise<GitHubStatus> {
    const app = await this.app();
    const token = await this.tokenBlob();
    return {
      appRegistered: app !== null,
      ...(app ? { appSlug: app.slug, manageUrl: `${this.webBase}/apps/${app.slug}/installations/new` } : {}),
      loggedIn: token !== null,
      ...(token
        ? {
            login: token.login,
            ...(token.name ? { name: token.name } : {}),
            ...(token.expiresAt ? { tokenExpiresAt: new Date(token.expiresAt).toISOString() } : {}),
          }
        : {}),
    };
  }

  /** URL for the user to open: registers the app if needed, then logs in. */
  loginUrl(): string {
    const nonce = this.newState("start");
    return `${this.opts.localBaseUrl()}/github/start?nonce=${nonce}`;
  }

  /** Resolve when a login completes (or immediately if already logged in). */
  async waitForLogin(timeoutMs: number): Promise<GitHubStatus> {
    if ((await this.status()).loggedIn) return this.status();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.loginWaiters = this.loginWaiters.filter((w) => w !== done);
        reject(
          new EzError(
            ErrorCode.Timeout,
            "GitHub login not completed yet.",
            "Ask the user whether the browser flow finished; call github_login_wait again or restart with github_login.",
          ),
        );
      }, timeoutMs);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      this.loginWaiters.push(done);
    });
    return this.status();
  }

  async logout(): Promise<void> {
    const token = await this.tokenBlob();
    const app = await this.app();
    const secret = await this.opts.secrets.get(SECRET_CLIENT);
    if (token && app && secret) {
      // Best effort revoke; local deletion is what matters.
      await this.fetch(`${this.apiBase}/applications/${app.clientId}/token`, {
        method: "DELETE",
        headers: {
          ...apiHeaders(),
          Authorization: `Basic ${Buffer.from(`${app.clientId}:${secret}`).toString("base64")}`,
        },
        body: JSON.stringify({ access_token: token.accessToken }),
      }).catch(() => undefined);
    }
    await this.opts.secrets.delete(SECRET_TOKEN);
  }

  /** A valid user access token, refreshed when close to expiry. */
  async token(): Promise<string> {
    const blob = await this.tokenBlob();
    if (!blob) {
      throw new EzError(
        ErrorCode.Unauthorized,
        "Not logged in to GitHub.",
        "Call github_login and have the user finish the browser flow.",
      );
    }
    if (blob.expiresAt === null || blob.expiresAt - Date.now() > 5 * 60 * 1000) return blob.accessToken;
    if (!blob.refreshToken || (blob.refreshExpiresAt !== null && blob.refreshExpiresAt < Date.now())) {
      await this.opts.secrets.delete(SECRET_TOKEN);
      throw new EzError(ErrorCode.Unauthorized, "GitHub session expired.", "Call github_login to sign in again.");
    }
    const refreshed = await this.exchange({ grant_type: "refresh_token", refresh_token: blob.refreshToken });
    const next: TokenBlob = { ...blob, ...refreshed };
    await this.opts.secrets.set(SECRET_TOKEN, JSON.stringify(next));
    return next.accessToken;
  }

  /** Every repo the app installation(s) let this user read. */
  async listRepos(): Promise<RepoInfo[]> {
    const installs = await this.paginate<{ id: number }>("/user/installations?per_page=100", "installations");
    if (installs.length === 0) {
      const app = await this.app();
      throw new EzError(
        ErrorCode.NotFound,
        "The ezapply GitHub App is not installed on any account.",
        app
          ? `Ask the user to install it and choose repos: ${this.webBase}/apps/${app.slug}/installations/new`
          : "Call github_login.",
      );
    }
    const repos = new Map<string, RepoInfo>();
    for (const inst of installs) {
      const list = await this.paginate<Record<string, unknown>>(
        `/user/installations/${inst.id}/repositories?per_page=100`,
        "repositories",
      );
      for (const r of list) {
        const info: RepoInfo = {
          fullName: String(r.full_name),
          private: Boolean(r.private),
          fork: Boolean(r.fork),
          archived: Boolean(r.archived),
          language: (r.language as string | null) ?? null,
          sizeKb: Number(r.size ?? 0),
          pushedAt: (r.pushed_at as string | null) ?? null,
          description: (r.description as string | null) ?? null,
          stars: Number(r.stargazers_count ?? 0),
          defaultBranch: String(r.default_branch ?? "main"),
        };
        repos.set(info.fullName, info);
      }
    }
    return [...repos.values()].sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""));
  }

  /** Header for git over HTTPS; passed per command, never written to git config. */
  async gitAuthHeader(): Promise<string> {
    const token = await this.token();
    return `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  }

  async identity(): Promise<{ login: string; name: string | null; userId: number } | null> {
    const b = await this.tokenBlob();
    return b ? { login: b.login, name: b.name, userId: b.userId } : null;
  }

  // ---- browser-facing routes ------------------------------------------------------------------

  /** Handles GET /github/*. Returns false when the path is not ours. */
  async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/github/")) return false;
    if (req.method !== "GET") {
      page(res, 405, "Method not allowed", "");
      return true;
    }
    try {
      switch (url.pathname) {
        case "/github/start":
          await this.onStart(url, res);
          return true;
        case "/github/app-created":
          await this.onAppCreated(url, res);
          return true;
        case "/github/installed":
          await this.onInstalled(url, res);
          return true;
        case "/github/callback":
          await this.onCallback(url, res);
          return true;
        default:
          page(res, 404, "Not found", "");
          return true;
      }
    } catch (err) {
      const e = EzError.from(err);
      this.opts.log.warn({ path: url.pathname, code: e.code, err: e.message }, "github flow failed");
      page(
        res,
        400,
        "GitHub setup failed",
        `${escapeHtml(e.message)}<br><br>Return to Claude Code and try github_login again.`,
      );
      return true;
    }
  }

  private async onStart(url: URL, res: ServerResponse): Promise<void> {
    this.consumeState(url.searchParams.get("nonce"), "start");
    const app = await this.app();
    if (app) {
      redirect(res, this.authorizeUrl(app));
      return;
    }
    const state = this.newState("manifest");
    const base = this.opts.localBaseUrl();
    const manifest = {
      name: `ezapply-${randomBytes(4).toString("hex")}`,
      url: "https://github.com",
      description: "Private, read-only access for ezapply to describe your projects.",
      public: false,
      redirect_url: `${base}/github/app-created`,
      callback_urls: [`${base}/github/callback`],
      setup_url: `${base}/github/installed`,
      setup_on_update: true,
      request_oauth_on_install: false,
      default_permissions: { contents: "read", metadata: "read" },
      default_events: [],
    };
    const action = `${this.webBase}/settings/apps/new?state=${state}`;
    page(
      res,
      200,
      "Create the ezapply GitHub App",
      `<p>ezapply will create a <b>private GitHub App</b> on your account with <b>read-only</b> access to repository
      contents. GitHub will ask you to confirm, then to choose which repositories it may read.</p>
      <form id="f" method="post" action="${escapeHtml(action)}">
        <input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
        <button type="submit">Continue to GitHub</button>
      </form>`,
    );
  }

  private async onAppCreated(url: URL, res: ServerResponse): Promise<void> {
    this.consumeState(url.searchParams.get("state"), "manifest");
    const code = url.searchParams.get("code");
    if (!code || !/^[\w-]+$/.test(code)) throw new EzError(ErrorCode.BadRequest, "Missing code from GitHub.");
    const r = await this.fetch(`${this.apiBase}/app-manifests/${code}/conversions`, {
      method: "POST",
      headers: apiHeaders(),
    });
    if (!r.ok) throw new EzError(ErrorCode.Internal, `GitHub rejected the app conversion (${r.status}).`);
    const data = (await r.json()) as Record<string, unknown>;
    const owner = (data.owner as { login?: string } | undefined)?.login;
    const app: AppFile = {
      schemaVersion: 1,
      appId: Number(data.id),
      slug: String(data.slug),
      clientId: String(data.client_id),
      htmlUrl: String(data.html_url),
      ...(owner ? { owner } : {}),
      createdAt: new Date().toISOString(),
    };
    await this.opts.secrets.set(SECRET_CLIENT, String(data.client_secret));
    await writeJsonAtomic(this.opts.appFilePath, app);
    this.opts.log.info({ slug: app.slug }, "github app created");
    // The private key and webhook secret are not needed (no server-to-server calls) and are discarded.
    this.newState("install");
    redirect(res, `${this.webBase}/apps/${app.slug}/installations/new`);
  }

  private async onInstalled(_url: URL, res: ServerResponse): Promise<void> {
    // GitHub does not echo our state here, so accept only while an install we started is pending.
    const pending = [...this.states.entries()].find(([, p]) => p.purpose === "install" && p.expires > Date.now());
    const app = await this.app();
    if (!app) throw new EzError(ErrorCode.BadRequest, "No app registered.");
    if (pending) this.states.delete(pending[0]);
    if (!pending && (await this.tokenBlob())) {
      page(res, 200, "Repository access updated", "You can close this tab and return to Claude Code.");
      return;
    }
    redirect(res, this.authorizeUrl(app));
  }

  private async onCallback(url: URL, res: ServerResponse): Promise<void> {
    this.consumeState(url.searchParams.get("state"), "oauth");
    const code = url.searchParams.get("code");
    if (!code) throw new EzError(ErrorCode.BadRequest, "Missing code from GitHub.");
    const tokens = await this.exchange({ code, redirect_uri: `${this.opts.localBaseUrl()}/github/callback` });
    const me = await this.fetch(`${this.apiBase}/user`, {
      headers: { ...apiHeaders(), Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!me.ok) throw new EzError(ErrorCode.Internal, `Could not read the GitHub user (${me.status}).`);
    const user = (await me.json()) as { login: string; name: string | null; id: number };
    const blob: TokenBlob = { ...tokens, login: user.login, name: user.name ?? null, userId: user.id };
    await this.opts.secrets.set(SECRET_TOKEN, JSON.stringify(blob));
    this.opts.log.info({ login: user.login }, "github login complete");
    for (const w of this.loginWaiters.splice(0)) w();
    page(res, 200, `Signed in as ${escapeHtml(user.login)}`, "You can close this tab and return to Claude Code.");
  }

  // ---- internals ---------------------------------------------------------------------------------

  private authorizeUrl(app: AppFile): string {
    const state = this.newState("oauth");
    const q = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: `${this.opts.localBaseUrl()}/github/callback`,
      state,
    });
    return `${this.webBase}/login/oauth/authorize?${q}`;
  }

  private async exchange(params: Record<string, string>): Promise<Omit<TokenBlob, "login" | "name" | "userId">> {
    const app = await this.app();
    const secret = await this.opts.secrets.get(SECRET_CLIENT);
    if (!app || !secret)
      throw new EzError(
        ErrorCode.Unauthorized,
        "GitHub app credentials missing.",
        "Call github_login to set up again.",
      );
    const r = await this.fetch(`${this.webBase}/login/oauth/access_token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "ezapply" },
      body: JSON.stringify({ client_id: app.clientId, client_secret: secret, ...params }),
    });
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || typeof data.access_token !== "string") {
      throw new EzError(
        ErrorCode.Unauthorized,
        `GitHub token exchange failed: ${String(data.error_description ?? data.error ?? r.status)}`,
        "Call github_login to sign in again.",
      );
    }
    const now = Date.now();
    const exp = (k: string) => (typeof data[k] === "number" ? now + (data[k] as number) * 1000 : null);
    return {
      accessToken: data.access_token,
      expiresAt: exp("expires_in"),
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : null,
      refreshExpiresAt: exp("refresh_token_expires_in"),
    };
  }

  private async paginate<T>(path: string, key: string): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = `${this.apiBase}${path}`;
    for (let pageNo = 0; next && pageNo < 50; pageNo++) {
      const r: Response = await this.fetch(next, {
        headers: { ...apiHeaders(), Authorization: `Bearer ${await this.token()}` },
      });
      if (r.status === 401) {
        throw new EzError(ErrorCode.Unauthorized, "GitHub rejected the token.", "Call github_login to sign in again.");
      }
      if (!r.ok) throw new EzError(ErrorCode.Internal, `GitHub API ${path} failed (${r.status}).`);
      const body = (await r.json()) as Record<string, unknown>;
      out.push(...((body[key] as T[] | undefined) ?? []));
      next = parseNextLink(r.headers.get("link"));
    }
    return out;
  }

  private async app(): Promise<AppFile | null> {
    const parsed = AppFile.safeParse(await readJson(this.opts.appFilePath).catch(() => null));
    return parsed.success ? parsed.data : null;
  }

  private async tokenBlob(): Promise<TokenBlob | null> {
    const raw = await this.opts.secrets.get(SECRET_TOKEN);
    if (!raw) return null;
    const parsed = TokenBlob.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  }

  private newState(purpose: Pending["purpose"]): string {
    const now = Date.now();
    for (const [k, v] of this.states) if (v.expires < now) this.states.delete(k);
    const state = randomBytes(18).toString("base64url");
    this.states.set(state, { purpose, expires: now + STATE_TTL_MS });
    return state;
  }

  private consumeState(state: string | null, purpose: Pending["purpose"]): void {
    const p = state ? this.states.get(state) : undefined;
    if (!state || !p || p.purpose !== purpose || p.expires < Date.now()) {
      throw new EzError(ErrorCode.Unauthorized, "This link is invalid or expired.");
    }
    this.states.delete(state);
  }
}

function apiHeaders(): Record<string, string> {
  return { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": API_VERSION, "User-Agent": "ezapply" };
}

function parseNextLink(link: string | null): string | null {
  const m = link?.split(",").find((p) => /rel="next"/.test(p));
  return m?.match(/<([^>]+)>/)?.[1] ?? null;
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function page(res: ServerResponse, status: number, title: string, body: string): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action https://github.com",
    "X-Frame-Options": "DENY",
  });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ezapply: ${escapeHtml(title)}</title>
<style>:root{color-scheme:light dark;font:15px system-ui,sans-serif}body{max-width:560px;margin:12vh auto;padding:0 16px;line-height:1.5}
button{font:inherit;padding:8px 16px;margin-top:12px;cursor:pointer}</style></head>
<body><h2>${escapeHtml(title)}</h2>${body}</body></html>`);
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

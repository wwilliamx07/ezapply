import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ErrorCode, EzError } from "@ezapply/protocol";
import { z } from "zod";
import type { Logger } from "../logger.js";
import { readJson, writeJsonAtomic } from "../util/fs.js";
import { escapeHtml, htmlPage, readForm } from "../util/html.js";
import type { SecretStore } from "./secrets.js";

/**
 * GitHub access through a per-user GitHub App with read-only permissions.
 *
 * Setup (once): the companion serves a page that posts an App Manifest to GitHub; the user clicks
 * "Create", GitHub redirects back with a code we convert into app credentials, then the user installs
 * the app on the repos they choose. Login: standard OAuth web flow against the app, with the
 * callback on this companion. Every browser-facing step is guarded by a one-time state value.
 */

const AppFile = z.object({
  schemaVersion: z.literal(1),
  /** Unknown for a reused app that isn't installed anywhere yet. */
  appId: z.number().optional(),
  slug: z.string(),
  clientId: z.string(),
  htmlUrl: z.string(),
  owner: z.string().optional(),
  /** When this machine started using the app (created here, or reused). */
  createdAt: z.string(),
  /** created: made here from the manifest. reused: an app the user already had, connected with github_login app "existing". */
  origin: z.enum(["created", "reused"]).optional(),
  /** http://127.0.0.1:<port> when the app was set up here: its callback URL points there. */
  localBaseUrl: z.string().optional(),
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
  /** The app's callback URLs point at another port than the companion's: logins would redirect there. */
  portMismatch?: { appUrl: string; localUrl: string; hint: string };
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

/** Which app github_login should use: create a new one, or connect one the user already has. */
export type AppChoice = "new" | "existing";

/** An existing app's credentials the user entered, kept in memory until a login with them succeeds. */
interface AppCredentials {
  clientId: string;
  clientSecret: string;
  slug: string;
}

type Pending = {
  purpose: "start" | "manifest" | "install" | "reuse" | "oauth";
  expires: number;
  /** On "start": the app the user chose. */
  choice?: AppChoice;
  /** On "oauth" for a reused app: the credentials to exchange the code with. */
  creds?: AppCredentials;
};

export class GitHubService {
  private readonly webBase: string;
  private readonly apiBase: string;
  private readonly fetch: typeof fetch;
  private readonly states = new Map<string, Pending>();
  private loginWaiters: (() => void)[] = [];
  /** The refresh in flight: GitHub's refresh tokens are single-use, so concurrent callers share one. */
  private refreshing: Promise<string> | undefined;

  constructor(private readonly opts: GitHubOptions) {
    this.webBase = opts.webBase ?? "https://github.com";
    this.apiBase = opts.apiBase ?? "https://api.github.com";
    this.fetch = opts.fetchImpl ?? fetch;
  }

  async status(): Promise<GitHubStatus> {
    const app = await this.app();
    const token = await this.tokenBlob();
    const mismatch = app ? this.portMismatch(app) : undefined;
    return {
      appRegistered: app !== null,
      ...(app ? { appSlug: app.slug, manageUrl: `${this.webBase}/apps/${app.slug}/installations/new` } : {}),
      ...(mismatch ? { portMismatch: mismatch } : {}),
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

  /**
   * URL for the user to open. Without a choice: the app registered here, else a new one. "new" creates
   * another app from the manifest; "existing" connects an ezapply app the user already has on GitHub.
   */
  loginUrl(choice?: AppChoice): string {
    const nonce = this.newState("start", choice ? { choice } : {});
    return `${this.opts.localBaseUrl()}/github/start?nonce=${nonce}`;
  }

  /** Where GitHub must send logins back to; an existing app needs this among its callback URLs. */
  callbackUrl(): string {
    return `${this.opts.localBaseUrl()}/github/callback`;
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
    const blob = await this.requireTokenBlob();
    if (fresh(blob)) return blob.accessToken;
    // Parallel repo_sync calls (onboarding indexes repos in parallel subagents) must not each spend the
    // single-use refresh token: the second would get bad_refresh_token and log the user out.
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async refresh(): Promise<string> {
    // Re-read: another call may have refreshed while this one waited.
    const blob = await this.requireTokenBlob();
    if (fresh(blob)) return blob.accessToken;
    if (!blob.refreshToken || (blob.refreshExpiresAt !== null && blob.refreshExpiresAt < Date.now())) {
      await this.opts.secrets.delete(SECRET_TOKEN);
      throw new EzError(ErrorCode.Unauthorized, "GitHub session expired.", "Call github_login to sign in again.");
    }
    let refreshed: Awaited<ReturnType<GitHubService["exchange"]>>;
    try {
      refreshed = await this.exchange({ grant_type: "refresh_token", refresh_token: blob.refreshToken });
    } catch (err) {
      // Refreshed by someone else in the meantime (the stored refresh token changed): use theirs.
      const now = await this.tokenBlob();
      if (now && now.refreshToken !== blob.refreshToken && fresh(now)) return now.accessToken;
      throw err;
    }
    const next: TokenBlob = { ...blob, ...refreshed };
    await this.opts.secrets.set(SECRET_TOKEN, JSON.stringify(next));
    this.opts.log.info("github token refreshed");
    return next.accessToken;
  }

  private async requireTokenBlob(): Promise<TokenBlob> {
    const blob = await this.tokenBlob();
    if (!blob) {
      throw new EzError(
        ErrorCode.Unauthorized,
        "Not logged in to GitHub.",
        "Call github_login and have the user finish the browser flow.",
      );
    }
    return blob;
  }

  /** Where the app's callbacks point, when that differs from where the companion listens now. */
  private portMismatch(app: AppFile): GitHubStatus["portMismatch"] {
    const now = this.opts.localBaseUrl();
    if (!app.localBaseUrl || app.localBaseUrl === now) return undefined;
    return {
      appUrl: app.localBaseUrl,
      localUrl: now,
      hint:
        `The ezapply GitHub App was created while ezapply listened on ${app.localBaseUrl}, so GitHub sends ` +
        `logins there. Either move ezapply back (\`ezapply init --port ${new URL(app.localBaseUrl).port}\`, ` +
        `then restart ezapply), or have the user open ${this.webBase}/settings/apps/${app.slug} and change ` +
        `the Callback URL to ${now}/github/callback and the Setup URL to ${now}/github/installed.`,
    };
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

  /** Handles /github/* (GET, and POST for the existing-app form). Returns false when the path is not ours. */
  async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/github/")) return false;
    const post = req.method === "POST" && url.pathname === "/github/reuse";
    if (req.method !== "GET" && !post) {
      page(res, 405, "Method not allowed", "");
      return true;
    }
    try {
      if (post) {
        await this.onReuse(req, res);
        return true;
      }
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
        `${escapeHtml(e.message)}<br><br>Return to ezapply and ask to connect GitHub again.`,
      );
      return true;
    }
  }

  private async onStart(url: URL, res: ServerResponse): Promise<void> {
    const { choice } = this.consumeState(url.searchParams.get("nonce"), "start");
    if (choice === "existing") {
      this.reusePage(res);
      return;
    }
    const app = await this.app();
    if (app && choice !== "new") {
      redirect(res, this.authorizeUrl(app.clientId));
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
      origin: "created",
      localBaseUrl: this.opts.localBaseUrl(),
    };
    await this.opts.secrets.set(SECRET_CLIENT, String(data.client_secret));
    await writeJsonAtomic(this.opts.appFilePath, app);
    // A token belongs to the app that issued it; one from a replaced app is useless now.
    await this.opts.secrets.delete(SECRET_TOKEN);
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
      page(res, 200, "Repository access updated", "You can close this tab and return to ezapply.");
      return;
    }
    redirect(res, this.authorizeUrl(app.clientId));
  }

  /**
   * The page for connecting an app the user already has. GitHub offers no way to list a user's apps before
   * they sign in, and never shows an app's client secret again after creating it, so the user picks the app
   * on GitHub, copies its Client ID and generates a new client secret (older secrets keep working, e.g. on
   * another computer). They paste them here, into ezapply's own page, so the secret never passes through
   * the chat.
   */
  private reusePage(res: ServerResponse, error?: string): void {
    const state = this.newState("reuse");
    const settings = `${this.webBase}/settings/apps`;
    page(
      res,
      error ? 400 : 200,
      "Use your existing ezapply GitHub App",
      `${error ? `<p class="err">${escapeHtml(error)}</p>` : ""}
      <ol>
        <li>Open <a href="${escapeHtml(settings)}" target="_blank" rel="noopener">your GitHub Apps</a> and click
          <b>Edit</b> next to your <b>ezapply-…</b> app.</li>
        <li>Under <b>Callback URL</b>, add <code>${escapeHtml(this.callbackUrl())}</code> if it isn't listed
          (<b>Add Callback URL</b>), and <b>Save changes</b> at the bottom.</li>
        <li>Copy the <b>Client ID</b>, then click <b>Generate a new client secret</b> and copy it. It is shown only
          once; the app's other secrets keep working.</li>
      </ol>
      <form method="post" action="/github/reuse" autocomplete="off">
        <input type="hidden" name="state" value="${escapeHtml(state)}">
        <label>App name or its GitHub page<br><input name="app" required placeholder="ezapply-1a2b3c4d" size="40"></label><br>
        <label>Client ID<br><input name="client_id" required size="40"></label><br>
        <label>Client secret<br><input name="client_secret" type="password" required size="40"></label><br>
        <button type="submit">Continue to GitHub</button>
      </form>
      <p>These go only to ezapply on this computer; the secret is stored in your OS keychain once
      you've signed in.</p>`,
    );
  }

  /** The existing-app form: check the fields, keep them with the login's state, and send the user to authorize. */
  private async onReuse(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = await readForm(req);
    if (!form) throw new EzError(ErrorCode.BadRequest, "Form too large.");
    this.consumeState(form.get("state"), "reuse");
    const slug = appSlugFrom(form.get("app") ?? "");
    const clientId = (form.get("client_id") ?? "").trim();
    const clientSecret = (form.get("client_secret") ?? "").trim();
    const problem = !slug
      ? "Enter the app's name (like ezapply-1a2b3c4d) or paste its GitHub page address."
      : !/^[A-Za-z0-9.]{10,64}$/.test(clientId)
        ? "That doesn't look like a Client ID (it starts with Iv)."
        : !/^[A-Za-z0-9_]{20,128}$/.test(clientSecret)
          ? "That doesn't look like a client secret. Generate a new one and paste all of it."
          : undefined;
    if (problem || !slug) {
      this.reusePage(res, problem);
      return;
    }
    redirect(res, this.authorizeUrl(clientId, { clientId, clientSecret, slug }));
  }

  private async onCallback(url: URL, res: ServerResponse): Promise<void> {
    const { creds } = this.consumeState(url.searchParams.get("state"), "oauth");
    const code = url.searchParams.get("code");
    if (!code) throw new EzError(ErrorCode.BadRequest, "Missing code from GitHub.");
    const tokens = await this.exchange({ code, redirect_uri: this.callbackUrl() }, creds).catch((err: unknown) => {
      const e = EzError.from(err);
      throw creds ? new EzError(e.code, `${e.message}. Check that the Client ID and secret are from the same app.`) : e;
    });
    const me = await this.fetch(`${this.apiBase}/user`, {
      headers: { ...apiHeaders(), Authorization: `Bearer ${tokens.accessToken}` },
    });
    if (!me.ok) throw new EzError(ErrorCode.Internal, `Could not read the GitHub user (${me.status}).`);
    const user = (await me.json()) as { login: string; name: string | null; id: number };
    const installed = creds ? await this.connectReused(creds, tokens.accessToken) : true;
    const blob: TokenBlob = { ...tokens, login: user.login, name: user.name ?? null, userId: user.id };
    await this.opts.secrets.set(SECRET_TOKEN, JSON.stringify(blob));
    this.opts.log.info({ login: user.login, reused: Boolean(creds) }, "github login complete");
    for (const w of this.loginWaiters.splice(0)) w();
    const app = await this.app();
    page(
      res,
      200,
      `Signed in as ${escapeHtml(user.login)}`,
      installed || !app
        ? "You can close this tab and return to ezapply."
        : `The app isn't installed on your account yet, so it can't read any repositories:
          <a href="${escapeHtml(`${this.webBase}/apps/${app.slug}/installations/new`)}">install it and choose repositories</a>.`,
    );
  }

  /**
   * A login with an existing app's credentials worked: record the app and keep its secret. A user token only
   * sees installations of the app that issued it, so they name the app for certain (the typed name is only a
   * fallback for an app not installed anywhere yet). Returns whether it's installed.
   */
  private async connectReused(creds: AppCredentials, accessToken: string): Promise<boolean> {
    const r = await this.fetch(`${this.apiBase}/user/installations?per_page=100`, {
      headers: { ...apiHeaders(), Authorization: `Bearer ${accessToken}` },
    });
    const body = r.ok ? ((await r.json()) as { installations?: { app_id?: number; app_slug?: string }[] }) : {};
    const inst = body.installations?.[0];
    const slug = inst?.app_slug ?? creds.slug;
    const app: AppFile = {
      schemaVersion: 1,
      ...(inst?.app_id !== undefined ? { appId: inst.app_id } : {}),
      slug,
      clientId: creds.clientId,
      htmlUrl: `${this.webBase}/apps/${slug}`,
      createdAt: new Date().toISOString(),
      origin: "reused",
      localBaseUrl: this.opts.localBaseUrl(),
    };
    await this.opts.secrets.set(SECRET_CLIENT, creds.clientSecret);
    await writeJsonAtomic(this.opts.appFilePath, app);
    this.opts.log.info({ slug, installed: Boolean(inst) }, "github app reused");
    return inst !== undefined;
  }

  // ---- internals ---------------------------------------------------------------------------------

  private authorizeUrl(clientId: string, creds?: AppCredentials): string {
    const state = this.newState("oauth", creds ? { creds } : {});
    const q = new URLSearchParams({ client_id: clientId, redirect_uri: this.callbackUrl(), state });
    return `${this.webBase}/login/oauth/authorize?${q}`;
  }

  /** Trade a code or refresh token for tokens, with the registered app's credentials or ones just entered. */
  private async exchange(
    params: Record<string, string>,
    creds?: AppCredentials,
  ): Promise<Omit<TokenBlob, "login" | "name" | "userId">> {
    const clientId = creds?.clientId ?? (await this.app())?.clientId;
    const secret = creds?.clientSecret ?? (await this.opts.secrets.get(SECRET_CLIENT));
    if (!clientId || !secret)
      throw new EzError(
        ErrorCode.Unauthorized,
        "GitHub app credentials missing.",
        "Call github_login to set up again.",
      );
    const r = await this.fetch(`${this.webBase}/login/oauth/access_token`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "ezapply" },
      body: JSON.stringify({ client_id: clientId, client_secret: secret, ...params }),
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

  /** The stored token, or null when there is none or it can't be read (a damaged entry means: log in again). */
  private async tokenBlob(): Promise<TokenBlob | null> {
    const raw = await this.opts.secrets.get(SECRET_TOKEN);
    if (!raw) return null;
    const parsed = TokenBlob.safeParse(parseJson(raw));
    if (!parsed.success) this.opts.log.warn("github: stored token is unreadable; treating as logged out");
    return parsed.success ? parsed.data : null;
  }

  /** True while a login or app setup the user started in the browser can still complete. */
  flowPending(): boolean {
    const now = Date.now();
    for (const p of this.states.values()) if (p.expires > now) return true;
    return false;
  }

  private newState(purpose: Pending["purpose"], extra: Pick<Pending, "choice" | "creds"> = {}): string {
    const now = Date.now();
    for (const [k, v] of this.states) if (v.expires < now) this.states.delete(k);
    const state = randomBytes(18).toString("base64url");
    this.states.set(state, { purpose, expires: now + STATE_TTL_MS, ...extra });
    return state;
  }

  private consumeState(state: string | null, purpose: Pending["purpose"]): Pending {
    const p = state ? this.states.get(state) : undefined;
    if (!state || !p || p.purpose !== purpose || p.expires < Date.now()) {
      throw new EzError(ErrorCode.Unauthorized, "This link is invalid or expired.");
    }
    this.states.delete(state);
    return p;
  }
}

/** More than 5 minutes left (or no expiry at all). */
function fresh(blob: TokenBlob): boolean {
  return blob.expiresAt === null || blob.expiresAt - Date.now() > 5 * 60 * 1000;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function apiHeaders(): Record<string, string> {
  return { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": API_VERSION, "User-Agent": "ezapply" };
}

function parseNextLink(link: string | null): string | null {
  const m = link?.split(",").find((p) => /rel="next"/.test(p));
  return m?.match(/<([^>]+)>/)?.[1] ?? null;
}

/** "ezapply-1a2b", or the slug in github.com/apps/<slug> or github.com/settings/apps/<slug>, lowercased. */
export function appSlugFrom(input: string): string | undefined {
  const s = input.trim();
  const fromUrl = s.match(/github\.com\/(?:settings\/apps|apps)\/([A-Za-z0-9-]+)/i)?.[1];
  const slug = (fromUrl ?? s).toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(slug) ? slug : undefined;
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

/** GitHub's pages post forms to GitHub (the app manifest) or back to this companion (the existing-app form). */
function page(res: ServerResponse, status: number, title: string, body: string): void {
  htmlPage(res, status, title, body, { csp: "form-action 'self' https://github.com" });
}

import { ErrorCode, EzError } from "@ezapply/protocol";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RepoService } from "../../repos/service.js";
import type { Services } from "../../services.js";
import { tool } from "../result.js";

export function registerGitHubTools(server: McpServer, s: Services): void {
  server.registerTool(
    "github_status",
    {
      title: "GitHub status",
      description:
        "Whether the ezapply GitHub App exists and the user is logged in (login, token expiry, manage URL). " +
        "portMismatch means the app's callback URLs point at another port than the daemon's; follow its hint.",
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "github_status", () => s.github.status()),
  );

  server.registerTool(
    "github_login",
    {
      title: "Log in with GitHub",
      description:
        "Open the GitHub sign-in in the user's browser. When github_status shows no app registered, first ask the " +
        "user whether they already have an ezapply GitHub App (from another computer or an earlier install): " +
        'app "existing" connects it (they paste its Client ID and a new client secret into the local page, never ' +
        'into chat); app "new" creates a private read-only app, then they choose repositories and authorize. ' +
        "Omit app to use the one registered here. Tell the user what to expect, then call github_login_wait.",
      inputSchema: {
        app: z
          .enum(["new", "existing"])
          .optional()
          .describe(
            "Create a new app, or connect an existing one. Omit to use the app registered here (or create one).",
          ),
      },
    },
    tool(s.log, "github_login", async ({ app }: { app?: "new" | "existing" }) => {
      const status = await s.github.status();
      // Choosing an app replaces the registered one, so a mismatch with the old app's port doesn't matter.
      if (status.portMismatch && !app) {
        throw new EzError(ErrorCode.BadRequest, "The GitHub App points at another port.", status.portMismatch.hint);
      }
      const url = s.github.loginUrl(app);
      const opened = await s.opener.url(url).then(
        () => true,
        (err: unknown) => {
          s.log.warn({ err: (err as Error).message }, "github_login: could not open the browser");
          return false;
        },
      );
      const callbackUrl = s.github.callbackUrl();
      const steps =
        app === "existing"
          ? "The page walks them through it: on github.com/settings/apps, edit their ezapply-… app, add " +
            `${callbackUrl} as a Callback URL if it's missing, copy the Client ID, generate a new client secret, ` +
            "paste the app name, Client ID and secret into the page (never into this chat), then Authorize."
          : status.appRegistered && app !== "new"
            ? "Click Authorize, then come back."
            : "Click 'Continue to GitHub', then 'Create GitHub App', choose the repositories ezapply may read (All or Only select), Install, and finally Authorize.";
      return {
        url,
        openedBrowser: opened,
        firstTimeSetup: !status.appRegistered || app !== undefined,
        ...(app === "existing" ? { callbackUrl } : {}),
        tell: opened
          ? `A page opened in the browser. ${steps}`
          : `The browser didn't open by itself: ask the user to open ${url} (it's a page of the local ezapply daemon). ${steps}`,
      };
    }),
  );

  server.registerTool(
    "github_login_wait",
    {
      title: "Wait for GitHub login",
      description: "Block until the browser login completes (default up to 5 minutes).",
      inputSchema: { timeoutSeconds: z.number().int().min(5).max(900).default(300) },
    },
    tool(s.log, "github_login_wait", ({ timeoutSeconds }: { timeoutSeconds: number }) =>
      s.github.waitForLogin(timeoutSeconds * 1000),
    ),
  );

  server.registerTool(
    "github_logout",
    {
      title: "Log out of GitHub",
      description: "Revoke and delete the stored GitHub token. The app and cached repos stay.",
    },
    tool(s.log, "github_logout", async () => {
      await s.github.logout();
      return s.github.status();
    }),
  );

  server.registerTool(
    "github_list_repos",
    {
      title: "List accessible repos",
      description:
        "Every repository the ezapply app can read for this user, newest push first, with metadata for choosing: " +
        "private, fork, archived, language, size, last push, description, stars, and whether it is already selected. " +
        "If a repo is missing, the user can grant access via github_status.manageUrl.",
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "github_list_repos", async () => {
      const repos = await s.github.listRepos();
      const sel = await s.profile.repos();
      const selected = new Set(sel.exists && sel.valid ? sel.value.repos.map((r) => r.fullName) : []);
      return repos.map((r) => ({ ...r, selected: selected.has(r.fullName) }));
    }),
  );

  server.registerTool(
    "repos_selection_get",
    {
      title: "Selected repos",
      description: "The repos selected for the knowledge base (profile/repos.yaml), with cache and index state.",
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "repos_selection_get", async () => {
      const sel = await s.profile.repos();
      if (sel.exists && !sel.valid) return { valid: false, errors: sel.errors };
      const repos = sel.exists && sel.valid ? sel.value.repos : [];
      const out = [];
      for (const r of repos) {
        const meta = await s.repos.knowledgeMeta(r.fullName);
        const cached = await s.repos.requireCache(r.fullName).then(
          () => true,
          () => false,
        );
        out.push({ ...r, cached, indexedSha: meta?.indexedSha ?? null, indexedAt: meta?.indexedAt ?? null });
      }
      return out;
    }),
  );

  server.registerTool(
    "repos_selection_set",
    {
      title: "Set selected repos",
      description:
        "Replace the repo selection in profile/repos.yaml. Use source 'public-url' for public repos the user " +
        "contributed to but the app cannot see.",
      inputSchema: {
        repos: z.array(
          z.object({
            fullName: z.string().describe("owner/name"),
            source: z.enum(["app", "public-url"]).default("app"),
            note: z.string().optional(),
          }),
        ),
      },
    },
    tool(
      s.log,
      "repos_selection_set",
      async ({ repos }: { repos: { fullName: string; source: "app" | "public-url"; note?: string }[] }) => {
        await s.profile.writeRepos({ schemaVersion: 1, repos });
        return { selected: repos.map((r) => r.fullName) };
      },
    ),
  );

  server.registerTool(
    "repo_sync",
    {
      title: "Sync repo cache",
      description:
        "Clone or update a selected repo into repo-cache/<owner>__<name>/ (read-only). Returns the cache path, HEAD " +
        "sha, the last indexed sha, and the files changed since then (null = index everything). Read the files with " +
        "your own Read/Grep/Glob tools. Never modify, build or run anything in the cache.",
      inputSchema: { repo: z.string().describe("owner/name") },
    },
    tool(s.log, "repo_sync", async ({ repo }: { repo: string }) => {
      const sel = await s.profile.repos();
      const entry = sel.exists && sel.valid ? sel.value.repos.find((r) => r.fullName === repo) : undefined;
      if (!entry) {
        throw new EzError(ErrorCode.NotFound, `${repo} is not selected.`, "Add it with repos_selection_set first.");
      }
      return s.repos.sync(repo, entry.source);
    }),
  );

  server.registerTool(
    "repo_contributions",
    {
      title: "User's contributions",
      description:
        "From commit history: how many commits are the user's, when, and which areas they touched. Use it so claims " +
        "about shared repos describe the user's own work.",
      inputSchema: { repo: z.string() },
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "repo_contributions", ({ repo }: { repo: string }) => s.repos.contributions(repo)),
  );

  server.registerTool(
    "claims_check",
    {
      title: "Check claims",
      description:
        "Validate knowledge/<owner>__<name>/claims.yaml: schema, unique ids, and that every evidence path exists in " +
        "the cached repo with line ranges in bounds. Run after writing or editing claims.",
      inputSchema: { repo: z.string() },
      annotations: { readOnlyHint: true },
    },
    tool(s.log, "claims_check", ({ repo }: { repo: string }) => s.repos.checkClaims(repo)),
  );

  server.registerTool(
    "knowledge_mark_indexed",
    {
      title: "Mark repo indexed",
      description:
        "After writing/updating knowledge docs for a repo and passing claims_check, record the indexed commit in " +
        "knowledge/<owner>__<name>/meta.json so later syncs report only what changed.",
      inputSchema: { repo: z.string() },
    },
    tool(s.log, "knowledge_mark_indexed", async ({ repo }: { repo: string }) => ({
      ...(await s.repos.markIndexed(repo)),
      folder: s.repos.knowledgePath(repo),
      key: RepoService.key(repo),
    })),
  );
}

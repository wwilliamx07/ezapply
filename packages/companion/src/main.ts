import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { EzError, postingConversation } from "@ezapply/protocol";
import { antigravityBackend } from "./agent/antigravity.js";
import type { AgentCommand } from "./agent/child.js";
import { NeedsYou } from "./agent/needs.js";
import { PanelService } from "./agent/panel.js";
import { type ClaudeCommand, claudeBackend } from "./agent/process.js";
import { AgentService } from "./agent/service.js";
import { ExtensionBridge } from "./bridge/server.js";
import { type AppConfig, appDir, updateAppConfig } from "./config/app.js";
import { ReviewService } from "./documents/review.js";
import { DocumentsService } from "./documents/service.js";
import { FormsService } from "./forms/service.js";
import { FreshnessService } from "./freshness/service.js";
import { WorkspaceUpdates } from "./freshness/updates.js";
import { KeyringStore, type SecretStore } from "./github/secrets.js";
import { GitHubService } from "./github/service.js";
import { createHttpServer } from "./http.js";
import { createLogger, type Logger } from "./logger.js";
import { OnboardingService } from "./onboarding/service.js";
import { PostingsService } from "./postings/service.js";
import { ProfileService } from "./profile/service.js";
import { RepoService } from "./repos/service.js";
import type { Services } from "./services.js";
import { TemplateService } from "./templates/service.js";
import { UiAssets } from "./ui/assets.js";
import { useStylesheet } from "./util/html.js";
import { createDesktopOpener, type Opener } from "./util/open.js";
import { COMPANION_VERSION } from "./version.js";
import { Workspace } from "./workspace/workspace.js";

export interface CompanionOptions {
  config: AppConfig;
  log?: Logger;
  /**
   * Persist config changes (extension pinning) with the whole new config (tests). By default only the changed
   * fields are written into ~/.ezapply/config.json as it is on disk then.
   */
  saveConfig?: (config: AppConfig) => Promise<void>;
  /** Machine-level data dir (GitHub app file). Defaults to ~/.ezapply. */
  appDataDir?: string;
  /** How files and the companion's pages are opened for the user. Defaults to the OS opener. */
  opener?: Opener;
  /** Defaults to the OS keychain. */
  secrets?: SecretStore;
  /** The extension package folder, so extension_pair can tell the user what to load. */
  extensionDir?: string;
  /** The UI package's built pages (tests point it at a folder of their own). Defaults to packages/ui/dist. */
  ui?: UiAssets;
  /** Override how long a fresh companion waits for the paired extension to reconnect (tests). */
  reconnectGraceMs?: number;
  /** Claude Code and the Antigravity CLI, the agents the panel can run; with neither it is unavailable (tests). */
  claude?: ClaudeCommand;
  antigravity?: AgentCommand;
  /** Test hooks: GitHub endpoints and git clone URL. */
  github?: { webBase?: string; apiBase?: string; cloneUrl?: (fullName: string) => string };
}

export interface CompanionHandle {
  port: number;
  services: Services;
  /** Called if the HTTP server fails after it started listening (`ezapply` logs it and carries on). */
  onServerError(fn: (err: Error) => void): void;
  close(): Promise<void>;
}

/**
 * Wire services together and start listening on the loopback interface. `ezapply` is the only caller
 * outside tests: the companion lives exactly as long as it runs.
 */
export async function startCompanion(opts: CompanionOptions): Promise<CompanionHandle> {
  let config = opts.config;
  const log = opts.log ?? createLogger();
  const dataDir = opts.appDataDir ?? appDir();
  // The browser the extension reports becomes known once it connects (the bridge is built below).
  const opener = opts.opener ?? createDesktopOpener({ browser: () => bridge.browser() });
  let port = 0;
  /** Apply a change to the in-memory config and persist just that change (see updateAppConfig). */
  const persist = async (change: (c: AppConfig) => AppConfig) => {
    config = change(config);
    if (opts.saveConfig) await opts.saveConfig(config);
    else await updateAppConfig(change, config);
  };

  const workspace = new Workspace(config.workspace);
  await workspace.readConfig(); // fail fast on an invalid ezapply.config.json
  const postings = new PostingsService(workspace, log.child({ svc: "postings" }));
  const documents = new DocumentsService(workspace, log.child({ svc: "documents" }), opener);
  const ui = opts.ui ?? new UiAssets();
  useStylesheet(() => ui.baseStylesheet());
  const reviews = new ReviewService(
    workspace,
    log.child({ svc: "reviews" }),
    () => `http://${config.host}:${port}`,
    ui,
  );
  const profile = new ProfileService(workspace, log.child({ svc: "profile" }));
  const templates = new TemplateService(workspace, log.child({ svc: "templates" }));
  await profile.ensureAnswerSeed();
  const github = new GitHubService({
    secrets: opts.secrets ?? new KeyringStore(),
    appFilePath: join(dataDir, "github-app.json"),
    localBaseUrl: () => `http://${config.host}:${port}`,
    log: log.child({ svc: "github" }),
    ...(opts.github?.webBase ? { webBase: opts.github.webBase } : {}),
    ...(opts.github?.apiBase ? { apiBase: opts.github.apiBase } : {}),
  });
  const repos = new RepoService(workspace, github, log.child({ svc: "repos" }), opts.github?.cloneUrl);

  const bridge = new ExtensionBridge({
    companionVersion: COMPANION_VERSION,
    pairingToken: config.pairingToken,
    pairedExtensionId: config.pairedExtensionId,
    onPaired: (extensionId) => persist((c) => ({ ...c, pairedExtensionId: extensionId })),
    onForgotten: (pairingToken) => persist(({ pairedExtensionId: _, ...rest }) => ({ ...rest, pairingToken })),
    handlers: {
      "posting.capture": (payload) => postings.capture(payload),
      // Answered even for a posting deleted since: the extension keeps an unanswered report and sends it again.
      "posting.submitted": async ({ postingId, url, at }) => {
        await forms
          .submitted(postingId, "confirmation", { url, at })
          .catch((err) => log.warn({ postingId, err: EzError.from(err).message }, "submission not recorded"));
        return {};
      },
      // The side panel, relayed by the paired extension (agent/panel.ts).
      "panel.watch": async ({ open }) => {
        panel.watch(open);
        return {};
      },
      "panel.state": () => panel.state(),
      "panel.conversation": ({ key }) => panel.conversation(key),
      "panel.tab": (t) => panel.tab(t),
      "panel.send": ({ key, text }) => panel.send(key, text),
      "panel.stop": async ({ key }) => ({ stopped: agent.stop(key) }),
      "panel.reset": async ({ key }) => {
        await agent.reset(key);
        return {};
      },
      "panel.settings": (prefs) => agent.setPrefs(prefs),
      "panel.answer": async ({ cardId, answers }) => {
        panel.answer(cardId, answers);
        return {};
      },
      "panel.reply": async ({ cardId, message }) => {
        panel.reply(cardId, message);
        return {};
      },
      "panel.permission": async ({ cardId, allow, reason }) => {
        panel.permission(cardId, allow, reason);
        return {};
      },
      "panel.deletePosting": async ({ postingId }) => {
        await panel.deletePosting(postingId);
        return {};
      },
      "panel.markSubmitted": async ({ postingId }) => {
        await forms.submitted(postingId, "user");
        return {};
      },
      "panel.markOpen": async ({ postingId }) => {
        await forms.reopen(postingId);
        return {};
      },
      "panel.deleteDocument": async ({ postingId, file }) => {
        await panel.deleteDocument(postingId, file);
        return {};
      },
      "panel.workspaceChanges": ({ key }) => services.updates.list(key),
      "panel.workspaceChange": ({ key, ...req }) => services.updates.act(key, req),
      "panel.open": async (what) => {
        await panel.open(what);
        return {};
      },
    },
    onConnectionChange: (connected) => {
      if (!connected) panel.watch(0);
    },
    log: log.child({ svc: "bridge" }),
    ...(opts.reconnectGraceMs !== undefined ? { reconnectGraceMs: opts.reconnectGraceMs } : {}),
  });

  const freshness = new FreshnessService(workspace, profile, templates, repos, log.child({ svc: "freshness" }));
  const forms = new FormsService(workspace, postings, bridge, reviews, profile, log.child({ svc: "forms" }));

  const needs = new NeedsYou();
  const agent = new AgentService({
    workspace,
    needs,
    log: log.child({ svc: "agent" }),
    backends: {
      ...(opts.claude ? { claude: claudeBackend(opts.claude) } : {}),
      ...(opts.antigravity ? { antigravity: antigravityBackend(opts.antigravity) } : {}),
    },
  });
  // A posting's panel conversation works on its own posting, whichever is active.
  postings.sessionPostings(
    async (session) => postingConversation((await agent.conversationOf(session)) ?? "")?.postingId,
  );
  // An application's hand-off is a card in the conversation that filled it (a panel one; a terminal chat has none).
  forms.onHandoff((_posting, session, handoff) => {
    if (!session) return;
    void agent.conversationOf(session).then((key) => {
      if (key) agent.post(key, { kind: "handoff", at: new Date().toISOString(), ...handoff });
    });
  });

  const onboarding = new OnboardingService(
    () => services,
    () => `http://${config.host}:${port}`,
  );
  // Pushes go only to a connected extension: a panel update is worth nothing late, so it never waits for one.
  const panel = new PanelService(
    () => services,
    (update) => (bridge.status().connected ? bridge.call("panel.update", update, 5_000) : Promise.resolve()),
  );
  const services: Services = {
    version: COMPANION_VERSION,
    log,
    workspace,
    postings,
    documents,
    reviews,
    profile,
    templates,
    github,
    repos,
    freshness,
    updates: new WorkspaceUpdates(() => services),
    forms,
    onboarding,
    agent,
    needs,
    bridge,
    opener,
    ui,
    ...(opts.extensionDir ? { extensionDir: opts.extensionDir } : {}),
  };
  const server = createHttpServer({
    services,
    bridge,
    mcpToken: config.mcpToken,
    log: log.child({ svc: "http" }),
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;
  log.info({ port, workspace: workspace.root, version: COMPANION_VERSION }, "companion listening");
  // What's out of date in the workspace, for the panel's card: the repos need the network, so they're checked once
  // per run, in the background, never in the way of the first call or the extension's handshake.
  freshness.start();
  panel.start();

  return {
    port,
    services,
    onServerError: (fn) => server.on("error", fn),
    close: async () => {
      await agent.close();
      bridge.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

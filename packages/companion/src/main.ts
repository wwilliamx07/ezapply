import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { NeedsYou } from "./agent/needs.js";
import { PanelService } from "./agent/panel.js";
import type { ClaudeCommand } from "./agent/process.js";
import { AgentService } from "./agent/service.js";
import { ExtensionBridge } from "./bridge/server.js";
import { type ChatHost, ChatSessions, chatHost } from "./chat.js";
import { type AppConfig, appDir, updateAppConfig } from "./config/app.js";
import { ReviewService } from "./documents/review.js";
import { DocumentsService } from "./documents/service.js";
import { FormsService } from "./forms/service.js";
import { FreshnessService } from "./freshness/service.js";
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
  /** Claude Code, for the panel's agent; without it the agent is unavailable (tests, `ezapply chat`). */
  claude?: ClaudeCommand;
  /** Test hooks: GitHub endpoints and git clone URL. */
  github?: { webBase?: string; apiBase?: string; cloneUrl?: (fullName: string) => string };
}

export interface CompanionHandle {
  port: number;
  services: Services;
  /** What `ezapply chat` reads to decide when to restart Claude. */
  chat: ChatHost;
  /** Called if the HTTP server fails after it started listening (`ezapply chat` logs it and carries on). */
  onServerError(fn: (err: Error) => void): void;
  close(): Promise<void>;
}

/**
 * Wire services together and start listening on the loopback interface. `ezapply chat` is the only caller
 * outside tests: the companion lives exactly as long as the chat.
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
      // The side panel, relayed by the paired extension (agent/panel.ts).
      "panel.watch": async ({ open }) => {
        panel.watch(open);
        return {};
      },
      "panel.state": () => panel.state(),
      "panel.conversation": ({ key }) => panel.conversation(key),
      "panel.tab": (t) => panel.tab(t),
      "panel.send": ({ key, text }) => panel.send(key, text),
      "panel.stop": async () => ({ stopped: agent.stop() }),
      "panel.reset": async ({ key }) => {
        await agent.reset(key);
        return {};
      },
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
      "panel.activate": async ({ postingId }) => {
        await postings.activate(postingId);
        return {};
      },
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
    ...(opts.claude ? { claude: opts.claude } : {}),
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
    forms,
    onboarding,
    agent,
    needs,
    bridge,
    opener,
    ui,
    ...(opts.extensionDir ? { extensionDir: opts.extensionDir } : {}),
  };
  const sessions = new ChatSessions();
  const server = createHttpServer({
    services,
    bridge,
    mcpToken: config.mcpToken,
    chat: sessions,
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
  // What's out of date in the workspace, for `workspace_changes`: the repos need the network, so they're
  // checked once per chat, in the background, never in the way of the first call or the extension's handshake.
  freshness.start();
  panel.start();

  return {
    port,
    services,
    chat: chatHost(postings, workspace, sessions),
    onServerError: (fn) => server.on("error", fn),
    close: async () => {
      await agent.close();
      bridge.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

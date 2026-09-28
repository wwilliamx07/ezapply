import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { CloseCode } from "@ezapply/protocol";
import { ExtensionBridge } from "./bridge/server.js";
import { ChatSessions } from "./chat.js";
import {
  appDir,
  type DaemonConfig,
  daemonStatePath,
  loadDaemonState,
  saveDaemonState,
  updateDaemonConfig,
} from "./config/daemon.js";
import { ReviewService } from "./documents/review.js";
import { DocumentsService } from "./documents/service.js";
import { FormsService } from "./forms/service.js";
import { KeyringStore, type SecretStore } from "./github/secrets.js";
import { GitHubService } from "./github/service.js";
import { createHttpServer } from "./http.js";
import { IdleMonitor } from "./idle.js";
import { createLogger, type Logger } from "./logger.js";
import { PostingsService } from "./postings/service.js";
import { ProfileService } from "./profile/service.js";
import { RepoService } from "./repos/service.js";
import type { Services } from "./services.js";
import { TemplateService } from "./templates/service.js";
import { desktopOpener, type Opener } from "./util/open.js";
import { COMPANION_VERSION } from "./version.js";
import { Workspace } from "./workspace/workspace.js";

export interface CompanionOptions {
  config: DaemonConfig;
  log?: Logger;
  /**
   * Persist config changes (extension pinning) with the whole new config (tests). By default only the changed
   * fields are written into ~/.ezapply/daemon.json as it is on disk then.
   */
  saveConfig?: (config: DaemonConfig) => Promise<void>;
  /** Machine-level data dir (GitHub app file, daemon-state.json). Defaults to ~/.ezapply. */
  appDataDir?: string;
  /** How files and the daemon's pages are opened for the user. Defaults to the OS opener. */
  opener?: Opener;
  /** Defaults to the OS keychain. */
  secrets?: SecretStore;
  /** The extension package folder, so extension_pair can tell the user what to load. */
  extensionDir?: string;
  /** Called when the CLI asks the daemon to stop (POST /control/shutdown), and after an idle timeout. */
  onShutdownRequest?: () => void;
  /**
   * Stop (through onShutdownRequest) after this long without work. Unset or 0: never. The CLI's daemon
   * passes daemon.json's idleTimeoutMinutes (default 15); Claude Code starts it again on demand.
   */
  idleTimeoutMs?: number;
  /** Override how long a fresh daemon waits for the paired extension to reconnect (tests). */
  reconnectGraceMs?: number;
  /** Test hooks: GitHub endpoints and git clone URL. */
  github?: { webBase?: string; apiBase?: string; cloneUrl?: (fullName: string) => string };
}

export interface CompanionHandle {
  port: number;
  services: Services;
  close(): Promise<void>;
}

/** Wire services together and start listening on the loopback interface. */
export async function startCompanion(opts: CompanionOptions): Promise<CompanionHandle> {
  let config = opts.config;
  const log = opts.log ?? createLogger();
  const dataDir = opts.appDataDir ?? appDir();
  const opener = opts.opener ?? desktopOpener;
  let port = 0;
  /** Apply a change to the in-memory config and persist just that change (see updateDaemonConfig). */
  const persist = async (change: (c: DaemonConfig) => DaemonConfig) => {
    config = change(config);
    if (opts.saveConfig) await opts.saveConfig(config);
    else await updateDaemonConfig(change, config);
  };

  const workspace = new Workspace(config.workspace);
  await workspace.readConfig(); // fail fast on an invalid ezapply.config.json
  const postings = new PostingsService(workspace, log.child({ svc: "postings" }));
  const documents = new DocumentsService(workspace, log.child({ svc: "documents" }), opener);
  const reviews = new ReviewService(workspace, log.child({ svc: "reviews" }), () => `http://${config.host}:${port}`);
  const profile = new ProfileService(workspace, log.child({ svc: "profile" }));
  const templates = new TemplateService(workspace, log.child({ svc: "templates" }));
  await profile.ensureAnswerSeed();
  const statePath = daemonStatePath(dataDir);
  const state = await loadDaemonState(statePath);
  const github = new GitHubService({
    secrets: opts.secrets ?? new KeyringStore(),
    appFilePath: join(dataDir, "github-app.json"),
    localBaseUrl: () => `http://${config.host}:${port}`,
    log: log.child({ svc: "github" }),
    ...(opts.github?.webBase ? { webBase: opts.github.webBase } : {}),
    ...(opts.github?.apiBase ? { apiBase: opts.github.apiBase } : {}),
  });
  const repos = new RepoService(workspace, github, log.child({ svc: "repos" }), opts.github?.cloneUrl);

  const onShutdown = opts.onShutdownRequest;
  const idle =
    onShutdown && opts.idleTimeoutMs
      ? new IdleMonitor({
          timeoutMs: opts.idleTimeoutMs,
          busy: () => bridge.pairingStatus().openUntil !== undefined || github.flowPending() || reviews.pending(),
          onIdle: () => {
            log.info({ minutes: Math.round((opts.idleTimeoutMs ?? 0) / 60_000) }, "idle: shutting down");
            bridge.close(CloseCode.Idle, "idle");
            onShutdown();
          },
        })
      : undefined;

  const bridge = new ExtensionBridge({
    companionVersion: COMPANION_VERSION,
    pairingToken: config.pairingToken,
    pairedExtensionId: config.pairedExtensionId,
    onPaired: (extensionId) => persist((c) => ({ ...c, pairedExtensionId: extensionId })),
    onForgotten: (pairingToken) => persist(({ pairedExtensionId: _, ...rest }) => ({ ...rest, pairingToken })),
    ...(state.extensionLastSeenAt !== undefined ? { extensionLastSeenAt: state.extensionLastSeenAt } : {}),
    onSeen: (at) => {
      saveDaemonState(statePath, { ...state, extensionLastSeenAt: at }).catch((err: Error) =>
        log.warn({ err: err.message }, "could not save daemon-state.json"),
      );
    },
    handlers: {
      "posting.capture": (payload) => postings.capture(payload),
    },
    log: log.child({ svc: "bridge" }),
    ...(idle ? { activity: idle } : {}),
    ...(opts.reconnectGraceMs !== undefined ? { reconnectGraceMs: opts.reconnectGraceMs } : {}),
  });

  const forms = new FormsService(workspace, postings, bridge, reviews, log.child({ svc: "forms" }));

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
    forms,
    bridge,
    opener,
    ...(opts.extensionDir ? { extensionDir: opts.extensionDir } : {}),
  };
  const server = createHttpServer({
    services,
    bridge,
    mcpToken: config.mcpToken,
    chat: new ChatSessions(),
    log: log.child({ svc: "http" }),
    ...(opts.onShutdownRequest ? { onShutdown: opts.onShutdownRequest } : {}),
    ...(idle ? { activity: idle } : {}),
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

  return {
    port,
    services,
    close: async () => {
      idle?.stop();
      bridge.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

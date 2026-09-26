import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { ExtensionBridge } from "./bridge/server.js";
import { appDir, type DaemonConfig, saveDaemonConfig } from "./config/daemon.js";
import { DocumentsService } from "./documents/service.js";
import { KeyringStore, type SecretStore } from "./github/secrets.js";
import { GitHubService } from "./github/service.js";
import { createHttpServer } from "./http.js";
import { createLogger, type Logger } from "./logger.js";
import { PostingsService } from "./postings/service.js";
import { ProfileService } from "./profile/service.js";
import { RepoService } from "./repos/service.js";
import type { Services } from "./services.js";
import { COMPANION_VERSION } from "./version.js";
import { Workspace } from "./workspace/workspace.js";

export interface CompanionOptions {
  config: DaemonConfig;
  log?: Logger;
  /** Persist config changes (extension pinning). Defaults to writing ~/.ezapply/daemon.json. */
  saveConfig?: (config: DaemonConfig) => Promise<void>;
  /** Machine-level data dir (GitHub app file). Defaults to ~/.ezapply. */
  appDataDir?: string;
  /** Defaults to the OS keychain. */
  secrets?: SecretStore;
  /** The extension package folder, so extension_pair can tell the user what to load. */
  extensionDir?: string;
  /** Called when the CLI asks the daemon to stop (POST /control/shutdown). */
  onShutdownRequest?: () => void;
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
  const save = opts.saveConfig ?? ((c: DaemonConfig) => saveDaemonConfig(c));
  let port = 0;

  const workspace = new Workspace(config.workspace);
  await workspace.readConfig(); // fail fast on an invalid ezapply.config.json
  const postings = new PostingsService(workspace, log.child({ svc: "postings" }));
  const documents = new DocumentsService(workspace, log.child({ svc: "documents" }));
  const profile = new ProfileService(workspace, log.child({ svc: "profile" }));
  await profile.ensureAnswerSeed();
  const github = new GitHubService({
    secrets: opts.secrets ?? new KeyringStore(),
    appFilePath: join(opts.appDataDir ?? appDir(), "github-app.json"),
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
    onPaired: async (extensionId) => {
      config = { ...config, pairedExtensionId: extensionId };
      await save(config);
    },
    onForgotten: async (pairingToken) => {
      const { pairedExtensionId: _, ...rest } = config;
      config = { ...rest, pairingToken };
      await save(config);
    },
    handlers: {
      "posting.capture": (payload) => postings.capture(payload),
    },
    log: log.child({ svc: "bridge" }),
  });

  const services: Services = {
    version: COMPANION_VERSION,
    log,
    workspace,
    postings,
    documents,
    profile,
    github,
    repos,
    bridge,
    ...(opts.extensionDir ? { extensionDir: opts.extensionDir } : {}),
  };
  const server = createHttpServer({
    services,
    bridge,
    mcpToken: config.mcpToken,
    log: log.child({ svc: "http" }),
    ...(opts.onShutdownRequest ? { onShutdown: opts.onShutdownRequest } : {}),
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
      bridge.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

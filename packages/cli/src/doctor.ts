import { join } from "node:path";
import {
  agentFileStatus,
  appConfigPath,
  appDir,
  createLogger,
  GitHubService,
  githubDetail,
  HEALTH_MODE,
  installCommand,
  KeyringStore,
  loadAppConfig,
  texStatus,
  UiAssets,
  Workspace,
  which,
} from "@ezapply/companion";
import { PROTOCOL_VERSION } from "@ezapply/protocol";
import { fetchHealth } from "./health.js";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/**
 * `ezapply doctor`: the whole setup in one table, for people. The agent file, TeX and GitHub checks are the
 * ones behind workspace_check (from the companion), worded for a terminal. Returns the exit code.
 */
export async function runDoctor(out: NodeJS.WritableStream = process.stdout): Promise<number> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const major = Number(process.versions.node.split(".")[0]);
  add("node", major >= 22, `v${process.versions.node} (need >= 22)`);

  const config = await loadAppConfig().catch((e: Error) => {
    add("config", false, e.message);
    return null;
  });
  const wsConfig = config ? await new Workspace(config.workspace).readConfig().catch((e: Error) => e) : null;
  if (config) {
    add("config", true, appConfigPath());
    add(
      "workspace",
      !(wsConfig instanceof Error),
      wsConfig instanceof Error ? `${config.workspace}: ${wsConfig.message} (run ezapply init)` : config.workspace,
    );
    const agent = await agentFileStatus(config.workspace);
    add("agent file", agent.done, agent.detail);
    // Not running is normal outside a chat: the companion lives inside `ezapply chat`.
    const health = await fetchHealth(config);
    const legacy = health !== null && health.mode !== HEALTH_MODE;
    add(
      "ezapply",
      !legacy,
      !health
        ? "not running (it runs while `ezapply chat` is open)"
        : legacy
          ? `a background daemon from an earlier build holds port ${config.port}; \`ezapply chat\` stops it`
          : `v${health.version} running in an \`ezapply chat\` on port ${config.port}`,
    );
    if (health && !legacy) {
      add(
        "protocol",
        health.protocolVersion === PROTOCOL_VERSION,
        `running v${health.protocolVersion}, cli v${PROTOCOL_VERSION}${health.protocolVersion === PROTOCOL_VERSION ? "" : " (exit the chat and start it again)"}`,
      );
      add(
        "extension",
        health.extensionConnected,
        health.extensionConnected ? "connected" : "not connected (open the browser / pair)",
      );
    }
    add(
      "extension paired",
      Boolean(config.pairedExtensionId),
      config.pairedExtensionId ?? 'not yet (in `ezapply chat`, say "set me up")',
    );
  } else if (!checks.some((c) => c.name === "config")) {
    add("config", false, "missing (run ezapply init)");
  }

  // The review page (and the companion's other pages) come from the UI package's build.
  const ui = new UiAssets();
  add("pages", ui.built(), ui.built() ? "built" : "not built (run npm run build in the ezapply folder)");

  // GitHub is optional until onboarding reaches it; only a broken setup (port mismatch) fails.
  const github = new GitHubService({
    secrets: new KeyringStore(),
    appFilePath: join(appDir(), "github-app.json"),
    localBaseUrl: () => `http://127.0.0.1:${config?.port ?? 0}`,
    log: createLogger({ toFile: false, level: "silent" }),
  });
  const gh = await github.status();
  // Without a config there's no ezapply port to compare the app's callback port with.
  if (!config) delete gh.portMismatch;
  add(
    "github",
    !gh.portMismatch,
    gh.appRegistered || gh.loggedIn ? githubDetail(gh) : "not set up yet (onboarding does this)",
  );

  // Documents: the engine is required; the rest are optional helpers.
  const configured = wsConfig && !(wsConfig instanceof Error) ? wsConfig.tex.engine : "auto";
  const tex = await texStatus(configured, "user");
  add("tex engine", tex.done, tex.detail);
  const optional = (name: string, bins: string[], why: string, install: string) => {
    const found = bins.map((b) => which(b)).find(Boolean);
    add(name, true, found ?? `not installed (optional: ${why}; ${install})`);
  };
  optional("latexdiff", ["latexdiff"], "change-highlighted PDFs", "part of TeX Live and MiKTeX; needs Perl");
  optional("ghostscript", ["gswin64c", "gswin32c", "gs"], "shrinking image-heavy PDFs", installCommand("ghostscript"));

  const width = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) out.write(`${c.ok ? " ok " : "FAIL"}  ${c.name.padEnd(width)}  ${c.detail}\n`);
  return checks.some((c) => !c.ok) ? 1 : 0;
}

import { join } from "node:path";
import {
  agentFileStatus,
  appConfigPath,
  appDir,
  createLogger,
  findAntigravity,
  findClaude,
  findCodex,
  GitHubService,
  githubDetail,
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
export async function runDoctor(): Promise<number> {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  add("node", major > 22 || (major === 22 && minor >= 12), `v${process.versions.node} (need >= 22.12)`);

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
    // Not running is fine: doctor is usually run while ezapply is stopped, or from another terminal.
    const health = await fetchHealth(config);
    add(
      "ezapply",
      true,
      health ? `v${health.version} running on port ${config.port}` : "not running (it runs while `ezapply` is open)",
    );
    if (health) {
      add(
        "protocol",
        health.protocolVersion === PROTOCOL_VERSION,
        `running v${health.protocolVersion}, cli v${PROTOCOL_VERSION}${health.protocolVersion === PROTOCOL_VERSION ? "" : " (stop ezapply and start it again)"}`,
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
      config.pairedExtensionId ?? "not yet (run `ezapply`: the setup page shows how)",
    );
  } else if (!checks.some((c) => c.name === "config")) {
    add("config", false, "missing (run ezapply init)");
  }

  // The panel runs whichever of these is chosen and installed: one is enough.
  const agents = [
    ["Claude Code", findClaude()],
    ["Antigravity", findAntigravity()],
    ["Codex", findCodex()],
  ] as const;
  const found = agents.flatMap(([name, c]) => (c ? [`${name} (${c.file})`] : []));
  add(
    "agents",
    found.length > 0,
    found.length > 0 ? found.join(", ") : "none on PATH (install Claude Code, agy or Codex)",
  );

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
  for (const c of checks) process.stdout.write(`${c.ok ? " ok " : "FAIL"}  ${c.name.padEnd(width)}  ${c.detail}\n`);
  return checks.some((c) => !c.ok) ? 1 : 0;
}

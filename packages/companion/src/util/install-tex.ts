import { installCommand } from "./install-hints.js";
import { run, which } from "./proc.js";

/**
 * How this system installs a TeX engine for the setup page's **Install it**, or null when it can't from here (the
 * page then shows the command to run). Each asks the user through the system, never through ezapply: Windows'
 * installer its own prompt if it needs one, polkit its password dialog, Terminal the password sudo asks for.
 */
export type TexInstallPlan =
  /** Run here and wait: done when an engine is found afterwards. `after` runs once it is (MiKTeX's settings). */
  | { how: "run"; program: string; args: string[]; after?: { program: string; args: string[] } }
  /** In a Terminal window the user watches: nothing to wait on, the page sees the engine when it's there. */
  | { how: "terminal"; command: string };

/** The plan for `platform`, given which programs exist (exported for tests). */
export function texInstallPlan(platform: NodeJS.Platform, has: (bin: string) => boolean): TexInstallPlan | null {
  if (platform === "win32") {
    if (!has("winget")) return null;
    const [program, ...args] = installCommand("tex", platform).split(" ") as [string, ...string[]];
    // MiKTeX fetches the packages a document needs; without this it asks, in a window nobody sees.
    return {
      how: "run",
      program,
      args,
      after: { program: "initexmf", args: ["--set-config-value=[MPM]AutoInstall=1"] },
    };
  }
  if (platform === "darwin") {
    // The cask's installer needs the password, which only a terminal can ask for.
    return has("brew") ? { how: "terminal", command: "brew install --cask mactex-no-gui" } : null;
  }
  if (has("pkexec") && has("apt-get")) {
    return { how: "run", program: "pkexec", args: ["apt-get", "install", "-y", "texlive-xetex", "latexmk"] };
  }
  return null;
}

export type TexInstallResult = { ok: true } | { terminal: true } | { ok: false; error: string };

const ENGINES = ["xelatex", "lualatex", "pdflatex", "tectonic"];

/**
 * Install a TeX engine with the fixed command for this system. Nothing in it comes from the caller, so a page that
 * asks can start this one install and nothing else.
 */
export async function installTex(): Promise<TexInstallResult> {
  const plan = texInstallPlan(process.platform, (bin) => which(bin) !== null);
  if (!plan) return { ok: false, error: "ezapply can't install it on this system: run the command shown." };
  if (plan.how === "terminal") {
    // The command is fixed and the script takes it from the environment, as the file dialogs do their titles.
    const r = await run(
      "osascript",
      [
        "-e",
        'tell application "Terminal" to do script (system attribute "EZAPPLY_INSTALL")',
        "-e",
        'tell application "Terminal" to activate',
      ],
      { env: { ...process.env, EZAPPLY_INSTALL: plan.command }, timeoutMs: 30_000 },
    ).catch((err: Error) => ({ exitCode: 1, stderr: err.message }));
    return r.exitCode === 0 ? { terminal: true } : { ok: false, error: `Terminal didn't open: ${r.stderr.trim()}` };
  }
  const r = await run(plan.program, plan.args, { timeoutMs: 45 * 60_000, maxOutputBytes: 16 * 1024 }).catch(
    (err: Error) => ({ exitCode: 1, stdout: "", stderr: err.message, timedOut: false }),
  );
  if (!ENGINES.some((e) => which(e))) {
    const why = r.timedOut ? "It took over 45 minutes." : lastLine(r.stderr) || lastLine(r.stdout);
    return { ok: false, error: `The install didn't finish${why ? `: ${why}` : "."}` };
  }
  if (plan.after && which(plan.after.program)) {
    await run(plan.after.program, plan.after.args, { timeoutMs: 60_000 }).catch(() => null);
  }
  return { ok: true };
}

function lastLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .pop() ?? ""
  );
}

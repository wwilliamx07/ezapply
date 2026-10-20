import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Keep only the tail of very chatty output. */
  maxOutputBytes?: number;
}

/** Run a program without a shell. Kills the whole process tree on timeout. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const max = opts.maxOutputBytes ?? 256 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const cap = (s: string) => (s.length > max ? s.slice(s.length - max) : s);
    child.stdout.on("data", (d: Buffer) => {
      stdout = cap(stdout + d.toString("utf8"));
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr = cap(stderr + d.toString("utf8"));
    });
    let timedOut = false;
    const timer =
      opts.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            killTree(child.pid);
          }, opts.timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut, durationMs: Date.now() - started });
    });
  });
}

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-pid, "SIGKILL");
  } catch {
    // already gone
  }
}

const whichCache = new Map<string, string>();

/**
 * Absolute path of an executable on PATH, or null. Hits are cached per process; misses are not, so a
 * tool the user installs while ezapply runs is found on the next call.
 */
export function which(bin: string): string | null {
  const cached = whichCache.get(bin);
  if (cached !== undefined) return cached;
  addInstalledToolDirsToPath();
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8", windowsHide: true });
  const found = r.status === 0 ? (r.stdout.split(/\r?\n/).find(Boolean) ?? null) : null;
  if (found) whichCache.set(bin, found);
  return found;
}

/**
 * Windows installers (winget MiKTeX, Git) update PATH for new terminals only, never for a running
 * process. Append their standard folders once they exist, so run() and which() find the tools.
 */
function addInstalledToolDirsToPath(): void {
  if (process.platform !== "win32") return;
  const local = process.env.LOCALAPPDATA;
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
  const dirs = [
    ...(local ? [join(local, "Programs", "MiKTeX", "miktex", "bin", "x64")] : []),
    join(programFiles, "MiKTeX", "miktex", "bin", "x64"),
    join(programFiles, "Git", "cmd"),
  ];
  const parts = (process.env.PATH ?? "").split(delimiter);
  const known = new Set(parts.map((p) => p.toLowerCase()));
  const add = dirs.filter((d) => !known.has(d.toLowerCase()) && existsSync(d));
  if (add.length > 0) process.env.PATH = [...parts, ...add].filter(Boolean).join(delimiter);
}

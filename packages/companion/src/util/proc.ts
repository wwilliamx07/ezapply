import { spawn, spawnSync } from "node:child_process";

export interface RunResult {
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

const whichCache = new Map<string, string | null>();

/** Absolute path of an executable on PATH, or null. Cached per process. */
export function which(bin: string): string | null {
  const cached = whichCache.get(bin);
  if (cached !== undefined) return cached;
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], { encoding: "utf8", windowsHide: true });
  const found = r.status === 0 ? (r.stdout.split(/\r?\n/).find(Boolean) ?? null) : null;
  whichCache.set(bin, found);
  return found;
}

export function clearWhichCache(): void {
  whichCache.clear();
}

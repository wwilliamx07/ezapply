import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";

/** How to run an agent's CLI: a native executable, or an npm install's `.cmd` launcher (only runs through cmd). */
export interface AgentCommand {
  file: string;
  /** Arguments that always come first (tests run a stub script through node). */
  args: string[];
  /** A .cmd/.bat launcher on Windows. */
  shell: boolean;
}

/** An agent's CLI: the file named by `override` (an environment variable), else `name` on PATH. */
export function findCommand(
  name: string,
  override: string,
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): AgentCommand | null {
  const isScript = (p: string) => platform === "win32" && /.(cmd|bat)$/i.test(p);
  const set = env[override];
  if (set) return { file: set, args: [], shell: isScript(set) };
  const names = platform === "win32" ? [`${name}.exe`, `${name}.cmd`, `${name}.bat`] : [name];
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean)) {
    for (const n of names) {
      const file = join(dir, n);
      if (existsSync(file)) return { file, args: [], shell: isScript(file) };
    }
  }
  return null;
}

export interface LineProcessOptions {
  command: AgentCommand;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  onLine: (line: string) => void;
  onExit: (code: number | null, stderrTail: string) => void;
}

/** An agent's CLI as a child process that takes JSON lines on stdin and writes lines on stdout. */
export class LineProcess {
  private readonly child: ChildProcess;
  private stderrTail = "";
  private exited = false;

  constructor(private readonly opts: LineProcessOptions) {
    const { file, shell } = opts.command;
    const args = [...opts.command.args, ...opts.args];
    this.child = spawn(shell ? quoteForCmd(file) : file, shell ? args.map(quoteForCmd) : args, {
      cwd: opts.cwd,
      env: opts.env,
      shell,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    createInterface({ input: this.child.stdout as NodeJS.ReadableStream }).on("line", opts.onLine);
    this.child.stderr?.on("data", (d: Buffer) => {
      this.stderrTail = (this.stderrTail + d.toString("utf8")).slice(-2000);
    });
    this.child.stdin?.on("error", () => {
      // The process went away; its exit is reported below.
    });
    this.child.on("error", (err) => this.exit(null, `${this.stderrTail}\n${err.message}`));
    this.child.on("exit", (code) => this.exit(code, this.stderrTail));
  }

  get alive(): boolean {
    return !this.exited;
  }

  write(o: unknown): void {
    if (this.exited || !this.child.stdin?.writable) return;
    this.child.stdin.write(`${JSON.stringify(o)}\n`);
  }

  /** Close stdin, which ends the process once it's idle; kill it if it hasn't exited after `graceMs`. */
  close(graceMs = 10_000): Promise<void> {
    if (this.exited) return Promise.resolve();
    const done = new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
    this.child.stdin?.end();
    const timer = setTimeout(() => this.kill(), graceMs);
    timer.unref();
    return done.finally(() => clearTimeout(timer));
  }

  /** The whole tree: the agent and what it started (its MCP relay, a running command). */
  kill(): void {
    if (this.exited) return;
    if (process.platform === "win32" && this.child.pid) {
      spawnSync("taskkill", ["/pid", String(this.child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      this.child.kill("SIGTERM");
      setTimeout(() => {
        if (!this.exited) this.child.kill("SIGKILL");
      }, 5000).unref();
    }
  }

  private exit(code: number | null, tail: string): void {
    if (this.exited) return;
    this.exited = true;
    this.opts.onExit(code, tail.trim());
  }
}

/** cmd.exe quoting for the shell launch of a .cmd file. */
function quoteForCmd(s: string): string {
  return /^[\w\-./:\\=@]+$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`;
}

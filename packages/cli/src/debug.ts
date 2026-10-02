import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DEBUG_DIR, debugReport, latestDebugSession, WorkspaceConfig } from "@ezapply/companion";
import { ErrorCode, EzError } from "@ezapply/protocol";

const USAGE = `Usage:
  ezapply debug on|off          Record every form call under debug/ in the workspace (or stop)
  ezapply debug report [dir]    Summarise a debug session (default: the newest)
  ezapply debug clean           Delete debug/ (it holds your filled values and the pages)
`;

/** `ezapply debug …` against the workspace at `root`. Returns the exit code; output goes to `write`. */
export async function runDebug(root: string, args: string[], write: (s: string) => void): Promise<number> {
  const [sub, arg] = args;
  switch (sub) {
    case "on":
    case "off":
      await setDebug(root, sub === "on");
      write(
        sub === "on"
          ? `Debug mode on: every form call is recorded under ${join(root, DEBUG_DIR)}. It holds your filled values;\n` +
              "turn it off with `ezapply debug off` and delete it with `ezapply debug clean`.\n"
          : "Debug mode off.\n",
      );
      return 0;
    case "clean":
      await rm(join(root, DEBUG_DIR), { recursive: true, force: true });
      write(`Deleted ${join(root, DEBUG_DIR)}.\n`);
      return 0;
    case "report": {
      const dir = arg ? resolve(root, DEBUG_DIR, arg) : await latestDebugSession(join(root, DEBUG_DIR));
      if (!dir) {
        write("No debug sessions yet. Turn debug mode on with `ezapply debug on`, then fill an application.\n");
        return 1;
      }
      write(await debugReport(dir));
      return 0;
    }
    default:
      write(USAGE);
      return sub === undefined || sub === "help" ? 0 : 2;
  }
}

/** Set `debug.autofill` in ezapply.config.json, keeping everything else as written. */
export async function setDebug(root: string, on: boolean): Promise<void> {
  const path = join(root, "ezapply.config.json");
  let raw: Record<string, unknown> = { schemaVersion: 1 };
  try {
    raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new EzError(ErrorCode.BadRequest, `${path} isn't valid JSON: fix it first.`);
    }
  }
  const debug = { ...((raw.debug as Record<string, unknown> | undefined) ?? {}), autofill: on };
  const next = { ...raw, debug };
  WorkspaceConfig.parse(next);
  await mkdir(root, { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { ErrorCode, EzError } from "@ezapply/protocol";

/** Opens something for the user. Replaceable in tests, where nothing may pop up. */
export interface Opener {
  /** A file in its default application (the user's PDF viewer). */
  file(path: string): Promise<void>;
  /** One of the daemon's own pages (`http://127.0.0.1:<port>/…`) in the default browser. */
  url(url: string): Promise<void>;
}

export const desktopOpener: Opener = {
  async file(path) {
    await stat(path).catch(() => {
      throw new EzError(ErrorCode.NotFound, `File not found: ${path}`);
    });
    await launch(path);
  },
  async url(url) {
    assertLocalUrl(url);
    await launch(url);
  },
};

/** Only the daemon's loopback pages may be opened: nothing Claude or a page supplies reaches the OS opener. */
export function assertLocalUrl(url: string): void {
  let u: URL | null = null;
  try {
    u = new URL(url);
  } catch {
    // reported below
  }
  if (u?.protocol !== "http:" || u.hostname !== "127.0.0.1" || !u.port || u.username || u.password) {
    throw new EzError(ErrorCode.BadRequest, `Refusing to open ${url}: only http://127.0.0.1:<port>/ pages are opened.`);
  }
}

/**
 * Hand a path or URL to the OS opener without a shell and without waiting for it: the opener may start a
 * long-lived viewer or browser, which must outlive this call (and a timeout must never kill it). Resolves
 * once the opener started; rejects when it couldn't (e.g. no xdg-open on a headless Linux).
 */
function launch(target: string): Promise<void> {
  // explorer.exe hands a file or URL to its registered program without a shell parsing it.
  const cmd = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [target], { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

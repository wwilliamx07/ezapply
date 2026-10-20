import { ext } from "../ext.js";

/**
 * Asking for access to websites when a form call finds it missing. The extension is granted every site at install,
 * but Chrome lets the user limit that to some sites. A form call can't ask itself:
 * `permissions.request` needs a user gesture, and a call from the companion is none. So it opens a small extension
 * window (`grant.html`) whose Allow access button asks, and waits a while for the grant.
 */

/** How long a form call waits for the user to allow access before saying so in its error. */
const GRANT_WAIT_MS = 15_000;

/** The access window open for a set of origins, so a retried call focuses it instead of opening another. */
const windows = new Map<string, number>();

/**
 * Open (or bring forward) the window asking for `origins`, and resolve true once they're granted, false after
 * `GRANT_WAIT_MS`. In memory: a background that restarts may open a second window for the same site.
 */
export async function askForAccess(origins: string[], label: { host: string }): Promise<boolean> {
  const granted = waitForGrant(origins, GRANT_WAIT_MS);
  await showWindow(origins, label).catch(() => undefined);
  return granted;
}

async function showWindow(origins: string[], label: { host: string }): Promise<void> {
  const key = origins.join(" ");
  const open = windows.get(key);
  if (
    open !== undefined &&
    (await ext.windows.get(open).then(
      () => true,
      () => false,
    ))
  ) {
    await ext.windows.update(open, { focused: true, state: "normal" });
    return;
  }
  const query = new URLSearchParams({ origins: key, host: label.host });
  const win = await ext.windows.create({
    url: ext.runtime.getURL(`grant.html?${query}`),
    type: "popup",
    width: 480,
    height: 300,
    focused: true,
  });
  if (win?.id !== undefined) windows.set(key, win.id);
}

function waitForGrant(origins: string[], waitMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const check = () => {
      void ext.permissions.contains({ origins }).then(
        (ok) => ok && done(true),
        () => undefined,
      );
    };
    const timer = setTimeout(() => done(false), waitMs);
    function done(ok: boolean) {
      clearTimeout(timer);
      ext.permissions.onAdded.removeListener(check);
      resolve(ok);
    }
    ext.permissions.onAdded.addListener(check);
  });
}

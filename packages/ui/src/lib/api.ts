/**
 * How a page talks to the companion: JSON under its base path (`data-base` on #root, e.g. /review/<id>), sent with
 * the page's cookie. The link's token was traded for that cookie on load, so the page takes it off the address
 * bar, where it would otherwise sit in history and in anything the user copies.
 */

export function pageBase(): string {
  const base = document.getElementById("root")?.dataset.base;
  if (!base) throw new Error("This page was opened without its address.");
  return base;
}

export function dropTokenFromUrl(): void {
  const url = new URL(location.href);
  if (!url.searchParams.has("t")) return;
  url.searchParams.delete("t");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`The companion answered ${status}.`);
  }
}

/** Thrown when the companion can't be reached: `ezapply chat` was closed. */
export class OfflineError extends Error {
  constructor() {
    super("ezapply isn't reachable. Is ezapply chat still running?");
  }
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", cache: "no-store" }).catch(() => {
    throw new OfflineError();
  });
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
  return (await res.json()) as T;
}

/** POST JSON; resolves with the response (the caller tells a 204 from a 409). */
export async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    throw new OfflineError();
  });
}

/** Listen for the companion's events on this page (Server-Sent Events); returns the unsubscribe. */
export function subscribe(path: string, on: Record<string, (data: unknown) => void>): () => void {
  if (typeof EventSource === "undefined") return () => {};
  const source = new EventSource(path, { withCredentials: true });
  for (const [event, fn] of Object.entries(on)) {
    source.addEventListener(event, (e) => {
      let data: unknown = null;
      try {
        data = JSON.parse((e as MessageEvent).data);
      } catch {}
      fn(data);
    });
  }
  return () => source.close();
}

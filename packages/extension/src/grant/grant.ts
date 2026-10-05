import { ext } from "../ext.js";

/**
 * The page a form call opens when the extension has no access to the application's page (`background/access.ts`).
 * `permissions.request` needs a user gesture, which a form call (a message from the companion) never is: the click
 * on Allow access here is one, in Chrome and in Firefox, as long as the request is made synchronously inside it.
 */

/** The origin patterns the page may ask for, from its URL: every site, or host patterns, never anything else. */
export function originsFrom(search: string): string[] {
  const raw = new URLSearchParams(search).get("origins") ?? "";
  return raw.split(" ").filter((o) => o === "<all_urls>" || /^(https|\*):\/\/[a-z0-9*.-]+(:\d+)?\/\*$/i.test(o));
}

function start(): void {
  const params = new URLSearchParams(location.search);
  const origins = originsFrom(location.search);
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  $("host").textContent = params.get("host") ?? "this site";
  const status = $("status");
  $("allow").addEventListener("click", () => {
    // Synchronous in the click: Firefox refuses the request once the handler has awaited anything.
    ext.permissions.request({ origins }).then(
      (ok) => {
        if (ok) {
          status.className = "muted";
          status.textContent = "Allowed. Claude can go on filling the application.";
          setTimeout(() => window.close(), 800);
        } else {
          status.className = "error";
          status.textContent = "Not allowed: the application can't be filled until you allow it.";
        }
      },
      (err: Error) => {
        status.className = "error";
        status.textContent = `The browser refused: ${err.message}`;
      },
    );
  });
}

if (typeof document !== "undefined" && document.getElementById("allow")) start();

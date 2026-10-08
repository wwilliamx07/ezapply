import type { ServerResponse } from "node:http";

/** The UI package's base stylesheet, once the companion knows where it is (`useStylesheet`). */
let stylesheet: () => string | null = () => null;

/** Give the pages below the UI package's look (main.ts, with `UiAssets.baseStylesheet`). */
export function useStylesheet(fn: () => string | null): void {
  stylesheet = fn;
}

/**
 * A small HTML page from the companion (GitHub setup, a review that's gone): no scripts, never framed. It takes
 * the UI package's base stylesheet when the UI is built, and a few inline rules otherwise. `csp` adds directives
 * to `default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self'`.
 */
export function htmlPage(
  res: ServerResponse,
  status: number,
  title: string,
  body: string,
  opts: { csp?: string; wide?: boolean } = {},
): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": `default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self'${opts.csp ? `; ${opts.csp}` : ""}`,
    "X-Frame-Options": "DENY",
  });
  const css = stylesheet();
  const width = opts.wide ? "980px" : "560px";
  const style = css
    ? `<link rel="stylesheet" href="${escapeHtml(css)}"><link rel="icon" href="/ui/favicon.svg" type="image/svg+xml">`
    : `<style>:root{color-scheme:light dark;font:15px system-ui,sans-serif}body{max-width:${width};margin:8vh auto;padding:0 16px;line-height:1.5}
button{font:inherit;padding:8px 16px;margin-top:12px;cursor:pointer}input{font:inherit;margin:2px 0 10px}
textarea{font:inherit;width:100%;box-sizing:border-box;margin:4px 0 10px}fieldset{margin:0 0 24px;border:1px solid #8886}.err{color:#c00}</style>`;
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>ezapply: ${escapeHtml(title)}</title>${style}</head>
<body class="ez-plain"><main class="ez-plain-card${opts.wide ? " ez-plain-wide" : ""}"><p class="ez-brand">ezapply</p>
<h1>${escapeHtml(title)}</h1>${body}</main></body></html>`);
}

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** A urlencoded form body (at most `maxBytes`). */
export async function readForm(
  req: AsyncIterable<Buffer | string>,
  maxBytes = 16 * 1024,
): Promise<URLSearchParams | null> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > maxBytes) return null;
  }
  return new URLSearchParams(raw);
}

import type { ServerResponse } from "node:http";

/**
 * A small HTML page from the companion (GitHub setup, document review): no scripts, inline styles only, never
 * framed. `csp` adds directives to `default-src 'none'; style-src 'unsafe-inline'`.
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
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'${opts.csp ? `; ${opts.csp}` : ""}`,
    "X-Frame-Options": "DENY",
  });
  const width = opts.wide ? "980px" : "560px";
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ezapply: ${escapeHtml(title)}</title>
<style>:root{color-scheme:light dark;font:15px system-ui,sans-serif}body{max-width:${width};margin:8vh auto;padding:0 16px;line-height:1.5}
button{font:inherit;padding:8px 16px;margin-top:12px;cursor:pointer}input{font:inherit;margin:2px 0 10px}
textarea{font:inherit;width:100%;box-sizing:border-box;margin:4px 0 10px}iframe{width:100%;height:80vh;border:1px solid #8886}
fieldset{margin:0 0 24px;border:1px solid #8886}.err{color:#c00}</style></head>
<body><h2>${escapeHtml(title)}</h2>${body}</body></html>`);
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

import { PanelApp, type PanelPush, type PanelTransport } from "@ezapply/ui/panel";
import { createRoot } from "react-dom/client";
import "@ezapply/ui/base.css";
import "@ezapply/ui/panel.css";

// The side panel as the extension mounts it (`extension/src/panel/main.tsx`), with a transport to the fuzzer's fake
// companion instead of the extension's background: each method is a POST to this run's fake, and the pushes are its
// Server-Sent Events.
const root = document.getElementById("root");
const run = root?.dataset.run ?? "";

async function post(path: string, method: string, params?: unknown): Promise<never> {
  const res = await fetch(`${run}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const out = (await res.json()) as { result?: unknown; error?: string };
  if (out.error) throw new Error(out.error);
  return out.result as never;
}

const side = (what: string, arg?: unknown) => post("panel/side", what, arg);

const transport: PanelTransport = {
  call: (method, params) => post("panel/call", method, params),
  capture: () => side("capture"),
  tab: (postingId) => side("tab", postingId),
  openTab: (url) => side("openTab", url),
  openSettings: () => side("openSettings"),
  connection: () => side("connection"),
  prefs: () => side("prefs"),
  savePrefs: (prefs) => side("savePrefs", prefs),
  subscribe(fn) {
    const source = new EventSource(`${run}/panel/events`);
    source.addEventListener("push", (e) => fn(JSON.parse((e as MessageEvent).data) as PanelPush));
    return () => source.close();
  },
};

if (root) createRoot(root).render(<PanelApp transport={transport} />);

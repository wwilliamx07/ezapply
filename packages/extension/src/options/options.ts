import { isOracleUrl } from "@ezapply/protocol/oracle";
import { type ConnState, DEFAULT_PORT } from "../background/settings.js";
import { ext } from "../ext.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function load(): Promise<void> {
  const { port, pairingToken, connState } = await ext.storage.local.get(["port", "pairingToken", "connState"]);
  $<HTMLInputElement>("port").value = String(typeof port === "number" ? port : DEFAULT_PORT);
  $<HTMLInputElement>("code").value = typeof pairingToken === "string" ? pairingToken : "";
  // The id the companion pins: Chrome's extension id, or Firefox's per-install UUID.
  $("extid").textContent = location.host;
  render(connState as ConnState | undefined);
  await renderAccess();
  await renderOracleAccess();
}

const hostOrigins = (): string[] => ext.runtime.getManifest().host_permissions ?? [];

/** Firefox lets the user withhold host permissions; Chrome grants them at install. */
async function renderAccess(): Promise<void> {
  $("access").hidden = await ext.permissions.contains({ origins: hostOrigins() });
}

$("grant").addEventListener("click", async () => {
  await ext.permissions.request({ origins: hostOrigins() });
  await renderAccess();
});

/**
 * Oracle career sites are granted one origin at a time (they can be on any host). Set posting asks for the one
 * it's clicked on; this lists the open Oracle tabs whose site still isn't granted, each with its own button.
 */
async function renderOracleAccess(): Promise<void> {
  const box = $("oracle");
  box.replaceChildren();
  const tabs = await ext.tabs.query({});
  const origins = [...new Set(tabs.flatMap((t) => (t.url && isOracleUrl(t.url) ? [new URL(t.url).origin] : [])))];
  for (const origin of origins) {
    if (await ext.permissions.contains({ origins: [`${origin}/*`] })) continue;
    const row = document.createElement("div");
    row.className = "row";
    const dot = document.createElement("span");
    dot.className = "dot error";
    const label = document.createElement("span");
    label.textContent = `No access to the Oracle career site ${new URL(origin).host}, so its forms can't be filled.`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Grant access";
    button.addEventListener("click", async () => {
      await ext.permissions.request({ origins: [`${origin}/*`] });
      await renderOracleAccess();
    });
    row.append(dot, label, button);
    box.append(row);
  }
}

function render(s: ConnState | undefined): void {
  const dot = $("dot");
  const status = $("status");
  dot.className = "dot";
  switch (s?.state) {
    case "connected":
      dot.classList.add("connected");
      status.textContent = `Connected to companion ${s.companionVersion}`;
      break;
    case "connecting":
      status.textContent = "Connecting…";
      break;
    case "error":
      dot.classList.add("error");
      status.textContent = s.hint ? `${s.message} ${s.hint}` : s.message;
      break;
    case "disconnected":
      status.textContent = `Not connected: ${s.reason}. In your ezapply workspace, run ./ezapply chat; it connects within 30 seconds.`;
      break;
    default:
      status.textContent =
        "Not paired yet. Ask Claude in your ezapply workspace to pair the extension; it pairs by itself.";
  }
}

$<HTMLFormElement>("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const port = Number($<HTMLInputElement>("port").value);
  const pairingToken = $<HTMLInputElement>("code").value.trim().toUpperCase();
  await ext.storage.local.set({ port, pairingToken });
});

ext.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.connState) render(changes.connState.newValue as ConnState);
});

void load();

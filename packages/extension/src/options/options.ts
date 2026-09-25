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
      status.textContent = `Not connected: ${s.reason}. Is \`ezapply daemon\` running?`;
      break;
    default:
      status.textContent = "Not paired yet";
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

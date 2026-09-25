import { type ConnState, DEFAULT_PORT } from "../background/settings.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function load(): Promise<void> {
  const { port, pairingToken, connState } = await chrome.storage.local.get(["port", "pairingToken", "connState"]);
  $<HTMLInputElement>("port").value = String(typeof port === "number" ? port : DEFAULT_PORT);
  $<HTMLInputElement>("code").value = typeof pairingToken === "string" ? pairingToken : "";
  $("extid").textContent = chrome.runtime.id;
  render(connState as ConnState | undefined);
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
  await chrome.storage.local.set({ port, pairingToken });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.connState) render(changes.connState.newValue as ConnState);
});

void load();

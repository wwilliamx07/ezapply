import { ext } from "../ext.js";
import { type ConnState, store } from "./settings.js";

const GREEN = "#16a34a";
const GREY = "#9ca3af";
const AMBER = "#d97706";
const RED = "#dc2626";

let flashTimer: ReturnType<typeof setTimeout> | undefined;

/** Resting badge: a small coloured pill for the connection state; tooltip names the active posting. */
export async function renderBadge(conn?: ConnState): Promise<void> {
  const state = conn ?? (await store.connState());
  const active = await store.activeLabel();
  const pending = await store.pendingCapture();

  let color = GREY;
  let status = "Not connected";
  switch (state.state) {
    case "connected":
      color = GREEN;
      status = "Connected";
      break;
    case "connecting":
      status = "Connecting…";
      break;
    case "unconfigured":
      color = AMBER;
      status = "Not paired: ask Claude to pair the extension";
      break;
    case "error":
      color = RED;
      status = state.hint ? `${state.message} ${state.hint}` : state.message;
      break;
    case "disconnected":
      status = `Not connected (${state.reason})`;
      break;
  }
  if (flashTimer === undefined) {
    await ext.action.setBadgeText({ text: pending ? "…" : " " });
    await ext.action.setBadgeBackgroundColor({ color: pending ? AMBER : color });
  }
  const lines = ["ezapply: Set posting", status];
  if (pending) lines.push("A capture is waiting to be sent.");
  if (active) lines.push(`Active: ${active}`);
  await ext.action.setTitle({ title: lines.join("\n") });
}

/** Briefly show a result symbol, then return to the resting badge. */
export async function flashBadge(kind: "ok" | "error", message?: string): Promise<void> {
  if (flashTimer !== undefined) clearTimeout(flashTimer);
  await ext.action.setBadgeText({ text: kind === "ok" ? "✓" : "!" });
  await ext.action.setBadgeBackgroundColor({ color: kind === "ok" ? GREEN : RED });
  if (message) await ext.action.setTitle({ title: `ezapply: ${message}` });
  flashTimer = setTimeout(
    () => {
      flashTimer = undefined;
      void renderBadge();
    },
    kind === "ok" ? 2500 : 6000,
  );
}

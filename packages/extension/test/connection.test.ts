import { CloseCode, PROTOCOL_VERSION } from "@ezapply/protocol";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Storage with a pairing code: the connection connects with it. */
const stored: Record<string, unknown> = {};
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[]) =>
        Object.fromEntries(
          [keys]
            .flat()
            .map((k) => [k, stored[k]])
            .filter(([, v]) => v !== undefined),
        ),
      ),
      set: vi.fn(async (o: Record<string, unknown>) => Object.assign(stored, o)),
      remove: vi.fn(async () => {}),
    },
  },
};

/** A socket the test drives: it opens when told, and the companion's messages are played into it. */
class FakeSocket {
  static all: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void | Promise<void>) | null = null;
  onclose: ((ev: { code: number }) => void | Promise<void>) | null = null;
  sent: { kind: string; id?: string }[] = [];
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
  async welcome() {
    this.onopen?.();
    await this.onmessage?.({
      data: JSON.stringify({ kind: "welcome", protocolVersion: PROTOCOL_VERSION, companionVersion: "1.0.0" }),
    });
  }
  async closed(code: number) {
    await this.onclose?.({ code });
  }
}
(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;

const { CompanionConnection } = await import("../src/background/connection.js");

describe("the connection to the companion", () => {
  beforeEach(() => {
    FakeSocket.all = [];
    Object.assign(stored, { port: 17373, pairingToken: "CODE-0000" });
  });

  it("opens one socket when several callers ask at once", async () => {
    const c = new CompanionConnection({} as never, "1.0.0");
    await Promise.all([c.ensureConnected(), c.ensureConnected(), c.ensureConnected()]);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("stays connected on the new socket when the old one closes after reconnecting", async () => {
    const c = new CompanionConnection({} as never, "1.0.0");
    await c.ensureConnected();
    const [a] = FakeSocket.all;
    await a?.welcome();
    // The settings change: the old socket is dropped and a new one opened; the old one's close comes late.
    const onclose = a?.onclose;
    stored.pairingToken = "CODE-1111";
    await c.settingsChanged();
    const b = FakeSocket.all[1];
    await b?.welcome();
    await onclose?.({ code: CloseCode.Replaced });
    expect(c.connected).toBe(true);
    await c.ensureConnected();
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("fails a call on a socket that's gone at once, not at its timeout", async () => {
    const c = new CompanionConnection({} as never, "1.0.0");
    await c.ensureConnected();
    const [a] = FakeSocket.all;
    await a?.welcome();
    const call = c.request("panel.state", {}, 60_000);
    await a?.closed(1006);
    await expect(call).rejects.toThrow("Connection closed");
    expect(c.connected).toBe(false);
  });
});

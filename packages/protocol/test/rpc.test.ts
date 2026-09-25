import { describe, expect, it } from "vitest";
import { z } from "zod";
import { EzError, type RequestMessage, type ResponseMessage, RpcPeer } from "../src/index.js";

const A = { "a.echo": { params: z.object({ text: z.string() }), result: z.object({ text: z.string() }) } };
const B = {
  "b.add": { params: z.object({ x: z.number(), y: z.number() }), result: z.number() },
  "b.slow": { params: z.object({}), result: z.null() },
  "b.fail": { params: z.object({}), result: z.null() },
};

type Handle = { handle(msg: RequestMessage | ResponseMessage): Promise<void> };

/** Two peers wired back to back, round-tripping through JSON like the real socket. */
function pair() {
  const peers: { a?: Handle; b?: Handle } = {};
  const to = (key: "a" | "b") => (msg: RequestMessage | ResponseMessage) =>
    queueMicrotask(() => void peers[key]?.handle(JSON.parse(JSON.stringify(msg))));
  const a = new RpcPeer({
    send: to("b"),
    remote: B,
    local: A,
    handlers: { "a.echo": async ({ text }) => ({ text }) },
    timeoutMs: 200,
  });
  const b = new RpcPeer({
    send: to("a"),
    remote: A,
    local: B,
    handlers: {
      "b.add": async ({ x, y }) => x + y,
      "b.slow": () => new Promise<null>(() => {}),
      "b.fail": async () => {
        throw new Error("boom");
      },
    },
  });
  peers.a = a;
  peers.b = b;
  return { a, b };
}

describe("RpcPeer", () => {
  it("round-trips requests in both directions", async () => {
    const { a, b } = pair();
    await expect(a.request("b.add", { x: 2, y: 3 })).resolves.toBe(5);
    await expect(b.request("a.echo", { text: "hi" })).resolves.toEqual({ text: "hi" });
  });

  it("rejects invalid params on the receiving side", async () => {
    const { a } = pair();
    await expect(a.request("b.add", { x: "2", y: 3 } as never)).rejects.toMatchObject({ code: "bad_request" });
  });

  it("propagates handler errors", async () => {
    const { a } = pair();
    await expect(a.request("b.fail", {})).rejects.toMatchObject({ code: "internal", message: "boom" });
  });

  it("times out", async () => {
    const { a } = pair();
    await expect(a.request("b.slow", {}, 50)).rejects.toMatchObject({ code: "timeout" });
  });

  it("failAll rejects in-flight requests", async () => {
    const { a } = pair();
    const p = a.request("b.slow", {}, 5_000);
    a.failAll(new EzError("extension_disconnected", "gone"));
    await expect(p).rejects.toMatchObject({ code: "extension_disconnected" });
  });
});

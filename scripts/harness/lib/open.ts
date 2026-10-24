import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CloneDescription } from "@ezapply/sites/clones";
import type { BrowserContext, Page } from "playwright";
import { StandIn } from "../standin/engine.ts";
import { launch, quietness, serve } from "./browser.ts";
import type { Clone } from "./store.ts";

interface OpenClone {
  context: BrowserContext;
  page: Page;
  standIn: StandIn;
  quiet: () => Promise<void>;
  close: () => Promise<void>;
}

/**
 * A clone opened in a fresh browser with no network: every request answered by the stand-in, the page's clock pinned
 * to the clone's capture time, at its starting URL.
 */
export async function openClone(
  clone: Clone,
  desc: CloneDescription,
  opts: { latency: number; headed?: boolean },
): Promise<OpenClone> {
  const profile = await mkdtemp(join(tmpdir(), "ezapply-harness-"));
  const context = await launch(profile, !!opts.headed);
  const standIn = new StandIn(clone, desc, { latency: opts.latency });
  await serve(context, standIn);
  const quiet = quietness(context);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.clock.install({ time: new Date(clone.meta.capturedAt) });
  await page.goto(clone.meta.url, { waitUntil: "load" }).catch(() => {});
  await quiet();
  return {
    context,
    page,
    standIn,
    quiet,
    close: async () => {
      await context.close();
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/** The share of pixels that differ between two PNG screenshots of the same size (1 when the sizes differ). */
export async function pixelDifference(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(
    async ([x, y]) => {
      const load = async (b64: string) => {
        const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
        const bmp = await createImageBitmap(blob);
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
        ctx.drawImage(bmp, 0, 0);
        return ctx.getImageData(0, 0, bmp.width, bmp.height);
      };
      const [p, q] = [await load(x), await load(y)];
      if (p.width !== q.width || p.height !== q.height) return 1;
      let diff = 0;
      const differs = (i: number) => Math.abs((p.data[i] ?? 0) - (q.data[i] ?? 0)) > 8;
      for (let i = 0; i < p.data.length; i += 4) if (differs(i) || differs(i + 1) || differs(i + 2)) diff++;
      return diff / (p.width * p.height);
    },
    [a.toString("base64"), b.toString("base64")] as const,
  );
}

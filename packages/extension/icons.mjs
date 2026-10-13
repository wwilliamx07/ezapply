// The extension's icons: ezapply's mark (packages/ui/static/mark.svg) as the PNGs Chrome takes for an extension and
// its toolbar button, which can't be SVG. Run after changing the mark: `npm run icons -w @ezapply/extension`. The PNGs
// are committed, so the build needs no rasterizer; `@napi-rs/canvas` comes with pdf.js.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

export const ICON_SIZES = [16, 32, 48, 128];

const root = dirname(fileURLToPath(import.meta.url));
const svg = await readFile(join(root, "../ui/static/mark.svg"));
for (const size of ICON_SIZES) {
  // Drawn at four times the size and scaled down, so a 16 px icon's strokes stay smooth.
  const big = createCanvas(size * 4, size * 4);
  big.getContext("2d").drawImage(await loadImage(svg), 0, 0, size * 4, size * 4);
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(big, 0, 0, size, size);
  await writeFile(join(root, "static/icons", `icon-${size}.png`), canvas.toBuffer("image/png"));
}
console.log(`icons: ${ICON_SIZES.join(", ")} px from mark.svg`);

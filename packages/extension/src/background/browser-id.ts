import type { BrowserInfo, BrowserName } from "@ezapply/protocol";

interface Brand {
  brand: string;
  version: string;
}

/** Chromium brands in the order to check them: the specific ones before the Chrome and Chromium they build on. */
const BRANDS: [string, BrowserName][] = [
  ["Microsoft Edge", "edge"],
  ["Brave", "brave"],
  ["Opera", "opera"],
  // Opera GX installs as opera.exe and registers the same App Paths key.
  ["Opera GX", "opera"],
  ["Vivaldi", "vivaldi"],
  ["Google Chrome", "chrome"],
  ["Chromium", "chromium"],
];

/**
 * Which browser this is, for the companion to open pages and files in (the one the user applies in).
 * Told by the `navigator.userAgentData` brands, available in the service worker. A browser that names none of
 * the known brands (Vivaldi hides its own) is reported as what it builds on, or not at all; the companion then
 * uses the system default.
 */
export async function detectBrowser(
  nav: { userAgentData?: { brands?: Brand[] } } = navigator as never,
): Promise<BrowserInfo | undefined> {
  const brands = nav.userAgentData?.brands ?? [];
  for (const [brand, name] of BRANDS) {
    const hit = brands.find((b) => b.brand === brand);
    if (hit) return { name, version: hit.version };
  }
  return undefined;
}

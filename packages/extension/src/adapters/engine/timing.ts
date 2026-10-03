import { resolveTiming, STANDARD_WAITS, type Timing } from "@ezapply/protocol/timing";

/**
 * The waits in use, in ms. The site owns them: its registry entry (`@ezapply/protocol/sites`) gives their values,
 * set with `useSiteWaits` when the adapter is created. The companion sends the user's overrides from
 * `autofill-timing.yaml` with every call, already resolved against the same site's waits; `setTiming` applies
 * them before the call runs, so each call uses what the file says now and a call without them uses the site's
 * own. Mutated in place so every module sees the current values.
 */
export const T: Timing = { ...STANDARD_WAITS };

let own: Timing = { ...STANDARD_WAITS };

/** The site's own waits: what `T` holds when the companion sends none. */
export function useSiteWaits(waits: Timing): void {
  own = { ...waits };
  Object.assign(T, own);
}

export function setTiming(timing?: Partial<Record<string, unknown>> | null): void {
  // Already resolved and scaled by the companion; resolving again only drops unknown keys and bad values.
  Object.assign(T, resolveTiming(own, timing));
}

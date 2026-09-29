import { DEFAULT_TIMING, resolveTiming, type Timing } from "@ezapply/protocol/timing";

/**
 * The waits in use, in ms. The companion sends them with every call (from the workspace's
 * `autofill-timing.yaml`); `setTiming` replaces them before the call runs, so each call uses what the file says
 * now and a call without them uses the defaults. Mutated in place so every module sees the current values.
 */
export const T: Timing = { ...DEFAULT_TIMING };

export function setTiming(timing?: Partial<Record<string, unknown>> | null): void {
  // Already resolved and scaled by the companion; resolving again only drops unknown keys and bad values.
  Object.assign(T, resolveTiming(timing));
}

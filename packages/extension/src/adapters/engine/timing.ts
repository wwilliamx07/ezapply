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

/** The last few waits read from `T`, newest last, while `watchWaits` is on. */
const reads: string[] = [];
/** `T`'s values while it's watched (its properties are getters then). */
const watched: Record<string, number> = {};

/**
 * For the debug trace (trace.ts): while on, every read of a wait in `T` is noted, so a wait can be named by the key
 * its caller passed (`waitFor(…, T.dropdownOpenMs)` reads `dropdownOpenMs` just before the call) without naming it
 * at each of the fillers' call sites. Each value becomes a getter for the length of a debugged call, and a plain
 * value again after it: a call without debug reads `T` exactly as before.
 */
export function watchWaits(on: boolean): void {
  const t = T as Record<string, number>;
  for (const key of Object.keys(t)) {
    const value = t[key] as number;
    watched[key] = value;
    Object.defineProperty(
      t,
      key,
      on
        ? {
            get() {
              reads.push(key);
              if (reads.length > 8) reads.shift();
              return watched[key];
            },
            set(v: number) {
              watched[key] = v;
            },
            enumerable: true,
            configurable: true,
          }
        : { value, writable: true, enumerable: true, configurable: true },
    );
  }
  reads.length = 0;
}

/** The wait just read whose value is `ms`: the name of the wait its caller passed. Undefined for a literal. */
export function waitName(ms: number): string | undefined {
  for (let i = reads.length - 1; i >= 0; i--) {
    const key = reads[i] as string;
    // The poll interval is read by every waitFor that doesn't pass its own, and is never a wait's length.
    if (key !== "pollMs" && watched[key] === ms) {
      reads.splice(i, 1);
      return key;
    }
  }
  return undefined;
}

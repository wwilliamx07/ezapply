/**
 * Runs tasks one at a time per key, in the order they were queued; different keys run concurrently.
 * Used where two calls on the same thing would collide: two builds of one .tex file share its .build
 * folder, two syncs of one repo fight over git's index.lock, two captures could race on one posting.
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }
}

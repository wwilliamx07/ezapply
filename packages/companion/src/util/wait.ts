/** Poll `probe` until it returns a non-null value or `timeoutMs` passes (then null). */
export async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number, everyMs = 300): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v !== null) return v;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

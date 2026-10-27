/**
 * A request body as text (at most `maxBytes`), or null when it's larger. The chunks are joined before decoding, so a
 * character split across two of them comes out whole.
 */
export async function readBody(req: AsyncIterable<Buffer | string>, maxBytes: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    size += buf.length;
    if (size > maxBytes) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function secretMatches(actual: string | null, expected: string | undefined) {
  if (!actual || !expected) return false;
  const a = createHash("sha256").update(actual).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function verifySignature(raw: string, signature: string | null, secret: string | undefined) {
  return !!secret && secretMatches(signature, `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`);
}

export async function boundedBody(request: Request, limit = 128_000): Promise<string> {
  if (Number(request.headers.get("content-length")) > limit) throw new Error("Payload too large");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Body required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("Payload too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies Meta's X-Hub-Signature-256 header: HMAC-SHA256 of the exact raw
 * request body with the App Secret. Constant-time comparison.
 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const received = Buffer.from(header.slice(7), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function signMetaBody(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
}

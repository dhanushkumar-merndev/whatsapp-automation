import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for secrets stored in the database (CRM credentials).
 * Format: "v1:" + base64(iv[12] | tag[16] | ciphertext).
 */
function key(raw = process.env.APP_ENCRYPTION_KEY): Buffer {
  const k = Buffer.from(raw ?? "", "base64");
  if (k.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return k;
}

export function encryptSecret(plain: string, rawKey?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64")}`;
}

export function decryptSecret(token: string, rawKey?: string): string {
  if (!token.startsWith("v1:")) throw new Error("Unsupported secret format");
  const buf = Buffer.from(token.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(rawKey), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

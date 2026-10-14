/** Media rules: WhatsApp Cloud API limits ∩ Supabase Free upload limit. */
export const MEDIA_RULES = {
  "application/pdf": { kind: "document", ext: "pdf", maxBytes: 50 * 1024 * 1024 },
  "image/jpeg": { kind: "image", ext: "jpg", maxBytes: 5 * 1024 * 1024 },
  "image/png": { kind: "image", ext: "png", maxBytes: 5 * 1024 * 1024 },
  "video/mp4": { kind: "video", ext: "mp4", maxBytes: 16 * 1024 * 1024 },
  "video/3gpp": { kind: "video", ext: "3gp", maxBytes: 16 * 1024 * 1024 },
} as const;
export type AllowedMime = keyof typeof MEDIA_RULES;

export function isAllowedMime(m: string): m is AllowedMime {
  return m in MEDIA_RULES;
}

/** Checks the file's real content type from its first bytes. */
export function sniffMime(head: Uint8Array): AllowedMime | null {
  const b = head;
  const starts = (sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...b.slice(8, 11));
    return brand.startsWith("3g") ? "video/3gpp" : "video/mp4";
  }
  return null;
}

export function sanitizeFileName(name: string): string {
  const cleaned = name.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 120) || "file";
}

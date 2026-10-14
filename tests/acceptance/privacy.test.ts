import { describe, expect, it, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import robots from "@/app/robots";
import nextConfig from "@/next.config";
import { proxy } from "@/proxy";
import { csvCell } from "@/lib/csv";
import { sniffMime, sanitizeFileName } from "@/lib/media/validate";
import { createMigratedDb, asRole } from "../helpers/pglite";

beforeAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "pk_test";
});

describe("24. No search engine or unauthenticated visitor can read private data", () => {
  it("robots.txt disallows all crawling", () => {
    expect(robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });

  it("every response carries noindex / nofollow and hardening headers", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*")!.headers;
    const get = (k: string) => all.find((h) => h.key === k)?.value ?? "";
    expect(get("X-Robots-Tag")).toContain("noindex");
    expect(get("X-Robots-Tag")).toContain("nofollow");
    expect(get("X-Frame-Options")).toBe("DENY");
    expect(get("Referrer-Policy")).toBe("no-referrer");
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("signed-out visitors are redirected to login for pages and get 401 for APIs", async () => {
    const page = await proxy(new NextRequest("https://app.example.com/leads/123"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/login?next=%2Fleads%2F123");
    const api = await proxy(new NextRequest("https://app.example.com/api/leads/export"));
    expect(api.status).toBe(401);
    const login = await proxy(new NextRequest("https://app.example.com/login"));
    expect(login.status).toBe(200);
    expect(login.headers.get("X-Robots-Tag")).toContain("noindex");
  });
});

describe("23. Uploaded media is private", () => {
  it("the media bucket is private and anonymous users cannot list or read objects", async () => {
    const db = await createMigratedDb();
    const bucket = await db.query<{ public: boolean; allowed_mime_types: string[] }>(`select public, allowed_mime_types from storage.buckets where id = 'media'`);
    expect(bucket.rows[0].public).toBe(false);
    expect(bucket.rows[0].allowed_mime_types).toContain("application/pdf");
    await db.query(`insert into storage.objects (bucket_id, name, metadata) values ('media', 'assets/x.pdf', '{"size": 10}')`);
    const anon = await asRole(db, "authenticated", { sub: "99999999-9999-4999-8999-999999999999", aal: "aal1" }, (tx) =>
      tx.query(`select * from storage.objects where bucket_id = 'media'`),
    );
    expect(anon.rows).toHaveLength(0);
  });

  it("validates real file content, not just the extension", () => {
    expect(sniffMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe("application/pdf");
    expect(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(sniffMime(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f]))).toBe("video/mp4");
    expect(sniffMime(new TextEncoder().encode("<html><script>"))).toBeNull();
    expect(sanitizeFileName('../../etc/"passwd"')).not.toContain("/");
  });
});

describe("CSV export safety", () => {
  it("escapes quotes/newlines and neutralises spreadsheet formulas", () => {
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+91987")).toBe("'+91987");
    expect(csvCell(null)).toBe("");
  });
});

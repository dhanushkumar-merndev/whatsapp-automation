import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signMetaBody } from "@/lib/whatsapp/signature";
import { createHarness } from "../helpers/harness";
import { metaInboundPayload } from "../helpers/meta";

const h = createHarness();

vi.mock("@/lib/server/pipeline", () => ({ createPipelineDeps: async () => h.deps, createStore: () => h.store, createSender: () => h.sender }));
vi.mock("next/server", async (orig) => {
  const mod = await orig<typeof import("next/server")>();
  // Run after() callbacks immediately in tests.
  return { ...mod, after: (fn: () => unknown) => void Promise.resolve().then(fn) };
});

beforeAll(() => {
  Object.assign(process.env, {
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
    NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk",
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    CRON_SECRET: "cron-secret-cron-secret",
    SUPABASE_SECRET_KEY: "sk",
    META_APP_SECRET: "meta-secret",
    META_WEBHOOK_VERIFY_TOKEN: "verify-me",
    META_ACCESS_TOKEN: "token",
    META_WABA_ID: "WABA1",
    META_PHONE_NUMBER_ID: "PN1",
    QSTASH_TOKEN: "q",
    QSTASH_CURRENT_SIGNING_KEY: "c",
    QSTASH_NEXT_SIGNING_KEY: "n",
    UPSTASH_REDIS_REST_URL: "https://redis.example.com",
    UPSTASH_REDIS_REST_TOKEN: "r",
  });
});

describe("Meta webhook endpoint", () => {
  it("answers the verification handshake only with the right verify token", async () => {
    const { GET } = await import("@/app/api/webhooks/whatsapp/route");
    const ok = await GET(new NextRequest("https://app.example.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");
    const bad = await GET(new NextRequest("https://app.example.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1"));
    expect(bad.status).toBe(403);
  });

  it("rejects unsigned or wrongly signed events without recording anything", async () => {
    const { POST } = await import("@/app/api/webhooks/whatsapp/route");
    const body = JSON.stringify(metaInboundPayload([{ text: "Hi" }]));
    const unsigned = await POST(new NextRequest("https://app.example.com/api/webhooks/whatsapp", { method: "POST", body }));
    expect(unsigned.status).toBe(401);
    const wrong = await POST(
      new NextRequest("https://app.example.com/api/webhooks/whatsapp", {
        method: "POST",
        body,
        headers: { "x-hub-signature-256": signMetaBody(body, "attacker") },
      }),
    );
    expect(wrong.status).toBe(401);
    expect(h.store.messages).toHaveLength(0);
  });

  it("records a signed customer message, acknowledges, then replies", async () => {
    const { POST } = await import("@/app/api/webhooks/whatsapp/route");
    const body = JSON.stringify(metaInboundPayload([{ text: "Hi", timestamp: h.clock.now() }]));
    const res = await POST(
      new NextRequest("https://app.example.com/api/webhooks/whatsapp", {
        method: "POST",
        body,
        headers: { "x-hub-signature-256": signMetaBody(body, "meta-secret") },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, recorded: 1 });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.sender.texts()[0]).toContain("Welcome to Star Growth Hub!");
  });
});

describe("QStash job endpoint", () => {
  it("rejects requests without a valid QStash signature", async () => {
    const { POST } = await import("@/app/api/jobs/qstash/route");
    const res = await POST(new NextRequest("https://app.example.com/api/jobs/qstash", { method: "POST", body: JSON.stringify({ jobId: crypto.randomUUID() }) }));
    expect(res.status).toBe(401);
  });
});

describe("Cron sweep endpoint", () => {
  it("requires the cron secret", async () => {
    const { GET } = await import("@/app/api/cron/sweep/route");
    const res = await GET(new NextRequest("https://app.example.com/api/cron/sweep"));
    expect(res.status).toBe(401);
  });
});

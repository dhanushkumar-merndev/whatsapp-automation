import { describe, expect, it } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { assertSafeUrl, checkUrlShape, isPrivateAddress } from "@/lib/crm/ssrf";
import { buildCrmHeaders, redact, signCrmBody } from "@/lib/crm/dispatch";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { buildCrmPayload } from "@/lib/engine/crm-payload";
import type { CrmDeliveryRecord, CrmIntegrationRecord, LeadRecord } from "@/lib/engine/types";

const prod = { requireHttps: true, allowLoopback: false };

describe("SSRF protection", () => {
  it("blocks private, loopback, link-local, metadata and reserved addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("requires HTTPS in production and rejects credentials or internal hosts in URLs", () => {
    expect(() => checkUrlShape("http://crm.example.com/hook", prod)).toThrow(/HTTPS/);
    expect(() => checkUrlShape("https://user:pw@crm.example.com/hook", prod)).toThrow(/Credentials/);
    expect(() => checkUrlShape("https://localhost/hook", prod)).toThrow();
    expect(() => checkUrlShape("https://db.internal/hook", prod)).toThrow();
    expect(() => checkUrlShape("ftp://crm.example.com", prod)).toThrow();
    expect(checkUrlShape("https://crm.example.com/hook", prod).hostname).toBe("crm.example.com");
  });

  it("rejects literal private IP destinations", async () => {
    await expect(assertSafeUrl("https://169.254.169.254/latest/meta-data", prod)).rejects.toThrow(/private/);
    await expect(assertSafeUrl("https://10.0.0.5/hook", prod)).rejects.toThrow(/private/);
  });

  it("allows http://localhost only in development", () => {
    expect(() => checkUrlShape("http://localhost:4000/hook", { requireHttps: false, allowLoopback: true })).not.toThrow();
  });
});

describe("CRM secrets and signing", () => {
  const key = randomBytes(32).toString("base64");

  it("encrypts secrets at rest with AES-256-GCM", () => {
    const token = encryptSecret("s3cr3t-value", key);
    expect(token).not.toContain("s3cr3t");
    expect(decryptSecret(token, key)).toBe("s3cr3t-value");
    expect(() => decryptSecret(token, randomBytes(32).toString("base64"))).toThrow();
  });

  it("signs the timestamped body and never leaks credentials in error text", () => {
    const integration: CrmIntegrationRecord = {
      id: "i",
      name: "CRM",
      url: "https://crm.example.com",
      enabled: true,
      authType: "bearer",
      credentials: { token: "tok_live_123456" },
      signingSecret: "whsec",
      fieldMapping: {},
    };
    const delivery: CrmDeliveryRecord = {
      id: "d",
      integrationId: "i",
      leadId: "l",
      eventId: "lead.submitted:l",
      eventType: "lead.submitted",
      payload: { a: 1 },
      status: "pending",
      attempts: 0,
      maxAttempts: 6,
      isTest: false,
    };
    const body = JSON.stringify(delivery.payload);
    const h = buildCrmHeaders(integration, delivery, body, new Date(1_700_000_000_000));
    expect(h.Authorization).toBe("Bearer tok_live_123456");
    expect(h["Idempotency-Key"]).toBe("lead.submitted:l");
    expect(h["X-SGH-Signature"]).toBe(`sha256=${createHmac("sha256", "whsec").update(`1700000000.${body}`).digest("hex")}`);
    expect(h["X-SGH-Signature"]).toBe(signCrmBody("whsec", "1700000000", body));
    expect(redact("failed with tok_live_123456 and Authorization: Bearer abc", ["tok_live_123456"])).not.toContain("tok_live_123456");
  });

  it("maps lead fields using the configured mapping", () => {
    const lead = { id: "L1", name: "Asha", phone: "919876543210", businessName: "Studio", service: "Ads", serviceId: "svc_ads", requirements: "Leads", email: null, status: "qualified", createdAt: "c", updatedAt: "u", flowId: "F", conversationId: "C", isTest: false } as unknown as LeadRecord;
    const p = buildCrmPayload({ lead, eventId: "e", eventType: "lead.submitted", mapping: { name: "full_name", email: "" }, occurredAt: "now" });
    expect(p.data).toMatchObject({ full_name: "Asha", phone: "+919876543210", business_name: "Studio", source: "WhatsApp" });
    expect(p.data).not.toHaveProperty("email");
  });
});

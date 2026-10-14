import { describe, expect, it } from "vitest";
import { signMetaBody, verifyMetaSignature } from "@/lib/whatsapp/signature";
import { buildMessagePayload, classifyMetaError } from "@/lib/whatsapp/payload";
import { extractInbound } from "@/lib/core/webhook-ingest";

describe("Meta webhook signature", () => {
  const secret = "app-secret";
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

  it("accepts the exact raw body signed with the App Secret", () => {
    expect(verifyMetaSignature(body, signMetaBody(body, secret), secret)).toBe(true);
  });

  it("rejects tampered bodies, wrong secrets and missing headers", () => {
    expect(verifyMetaSignature(body + " ", signMetaBody(body, secret), secret)).toBe(false);
    expect(verifyMetaSignature(body, signMetaBody(body, "other"), secret)).toBe(false);
    expect(verifyMetaSignature(body, null, secret)).toBe(false);
    expect(verifyMetaSignature(body, "sha1=abc", secret)).toBe(false);
    expect(verifyMetaSignature(body, "sha256=zz", secret)).toBe(false);
  });
});

describe("Cloud API payloads", () => {
  it("builds text, media, button and list messages within WhatsApp limits", () => {
    expect(buildMessagePayload("919876543210", { kind: "text", text: "Hi" })).toMatchObject({
      messaging_product: "whatsapp",
      to: "919876543210",
      type: "text",
      text: { body: "Hi", preview_url: false },
    });
    expect(
      buildMessagePayload("1", { kind: "media", mediaType: "document", assetId: "a", caption: "Brochure", filename: "b.pdf" }, "MEDIA_ID"),
    ).toMatchObject({ type: "document", document: { id: "MEDIA_ID", caption: "Brochure", filename: "b.pdf" } });
    const buttons = buildMessagePayload("1", { kind: "buttons", body: "Pick", buttons: [{ id: "a", title: "A very long button title here" }] });
    expect((buttons.interactive as { action: { buttons: { reply: { title: string } }[] } }).action.buttons[0].reply.title.length).toBeLessThanOrEqual(20);
    const list = buildMessagePayload("1", {
      kind: "list",
      body: "Which service?",
      buttonText: "View services",
      rows: [{ id: "svc_1", title: "Digital Marketing" }],
    }) as { interactive: { type: string; action: { button: string; sections: { rows: { id: string }[] }[] } } };
    expect(list.interactive.type).toBe("list");
    expect(list.interactive.action.sections[0].rows[0].id).toBe("svc_1");
  });

  it("refuses to send media that was not uploaded to Meta", () => {
    expect(() => buildMessagePayload("1", { kind: "media", mediaType: "image", assetId: "a" })).toThrow();
  });

  it("classifies Meta errors (re-engagement = window closed; 5xx/429 = transient)", () => {
    expect(classifyMetaError(400, 131047)).toEqual({ windowClosed: true, transient: false });
    expect(classifyMetaError(500, undefined).transient).toBe(true);
    expect(classifyMetaError(429, 130429).transient).toBe(true);
    expect(classifyMetaError(400, 100)).toEqual({ windowClosed: false, transient: false });
  });
});

describe("Inbound message parsing", () => {
  it("extracts text, interactive replies, button payloads and media captions", () => {
    expect(extractInbound({ type: "text", text: { body: "Hello" } })).toMatchObject({ type: "text", body: "Hello" });
    expect(extractInbound({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "svc_2", title: "Social" } } })).toMatchObject({
      body: "Social",
      payload: { reply_id: "svc_2", reply_title: "Social" },
    });
    expect(extractInbound({ type: "button", button: { payload: "YES", text: "Yes" } }).payload).toMatchObject({ reply_id: "YES" });
    expect(extractInbound({ type: "image", image: { id: "m1", caption: "logo" } }).body).toBe("logo");
    expect(extractInbound({ type: "reaction", reaction: { emoji: "👍" } }).body).toBeNull();
  });
});

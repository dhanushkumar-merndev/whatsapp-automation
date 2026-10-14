import { createHmac } from "node:crypto";
import type { CrmDeliveryRecord, CrmDeliveryResult, CrmDispatcher, CrmIntegrationRecord } from "@/lib/engine/types";
import { assertSafeUrl, UnsafeDestinationError, type UrlPolicy } from "./ssrf";
import { safeRequest } from "./safe-request";

export function signCrmBody(secret: string, timestamp: string, body: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** Remove anything that looks like a credential before storing/logging an error. */
export function redact(text: string, secrets: (string | null | undefined)[]): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("[redacted]");
  return out.replace(/(authorization|bearer|token|secret|password)(["':=\s]+)[^\s"',}]+/gi, "$1$2[redacted]");
}

export function buildCrmHeaders(integration: CrmIntegrationRecord, delivery: CrmDeliveryRecord, body: string, now = new Date()) {
  const ts = Math.floor(now.getTime() / 1000).toString();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "StarGrowthHub-WhatsApp/1.0",
    "X-SGH-Event-Id": delivery.eventId,
    "X-SGH-Event-Type": delivery.eventType,
    "X-SGH-Timestamp": ts,
    "Idempotency-Key": delivery.eventId,
  };
  if (integration.signingSecret) headers["X-SGH-Signature"] = signCrmBody(integration.signingSecret, ts, body);
  const c = integration.credentials;
  if (integration.authType === "bearer" && c.token) headers.Authorization = `Bearer ${c.token}`;
  if (integration.authType === "basic" && c.username) {
    headers.Authorization = `Basic ${Buffer.from(`${c.username}:${c.password ?? ""}`).toString("base64")}`;
  }
  if (integration.authType === "header" && c.headerName && c.headerValue) {
    if (/^(host|content-length|content-type|connection|transfer-encoding)$/i.test(c.headerName)) {
      throw new UnsafeDestinationError(`Header "${c.headerName}" cannot be overridden`);
    }
    headers[c.headerName] = c.headerValue;
  }
  return headers;
}

export class HttpCrmDispatcher implements CrmDispatcher {
  constructor(private readonly policy: UrlPolicy) {}

  async deliver(integration: CrmIntegrationRecord, delivery: CrmDeliveryRecord): Promise<CrmDeliveryResult> {
    const started = Date.now();
    const secrets = [integration.credentials.token, integration.credentials.password, integration.credentials.headerValue, integration.signingSecret];
    try {
      const url = await assertSafeUrl(integration.url, this.policy);
      const body = JSON.stringify(delivery.payload);
      const headers = buildCrmHeaders(integration, delivery, body);
      const res = await safeRequest(url, { method: "POST", headers, body, timeoutMs: 10_000, policy: this.policy });
      const ok = res.status >= 200 && res.status < 300;
      const redirect = res.status >= 300 && res.status < 400;
      return {
        ok,
        statusCode: res.status,
        error: ok ? null : redirect ? `HTTP ${res.status}: redirects are not followed` : `HTTP ${res.status}`,
        responseExcerpt: redact(res.body.slice(0, 500), secrets) || null,
        durationMs: Date.now() - started,
        retryable: !ok && (res.status >= 500 || res.status === 429 || res.status === 408),
      };
    } catch (e) {
      const unsafe = e instanceof UnsafeDestinationError;
      return {
        ok: false,
        statusCode: null,
        error: redact(`${unsafe ? "Blocked destination: " : "Network error: "}${e instanceof Error ? e.message : String(e)}`, secrets),
        responseExcerpt: null,
        durationMs: Date.now() - started,
        retryable: !unsafe,
      };
    }
  }
}

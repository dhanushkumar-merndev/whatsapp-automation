import http from "node:http";
import https from "node:https";
import { lookup as dnsLookup } from "node:dns";
import type { LookupFunction } from "node:net";
import { assertPublicAddress, type UrlPolicy } from "./ssrf";

export interface SafeResponse {
  status: number;
  body: string;
}

/**
 * Minimal HTTP client for untrusted destinations: validates the resolved IP at
 * connect time, never follows redirects, caps the response size and times out.
 */
export function safeRequest(
  url: URL,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string; timeoutMs: number; policy: UrlPolicy; maxBytes?: number },
): Promise<SafeResponse> {
  const maxBytes = init.maxBytes ?? 8192;
  const lookup: LookupFunction = (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: false }, (err, address, family) => {
      if (err) return callback(err, "", 0);
      try {
        assertPublicAddress(address as string, init.policy);
      } catch (e) {
        return callback(e as Error, "", 0);
      }
      callback(null, address as string, family as number);
    });
  };
  const mod = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: init.method,
        headers: { ...init.headers, ...(init.body !== undefined ? { "Content-Length": Buffer.byteLength(init.body).toString() } : {}) },
        lookup,
        timeout: init.timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size <= maxBytes) chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8").slice(0, maxBytes === 8192 ? 2000 : maxBytes) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Timed out after ${init.timeoutMs} ms`)));
    req.on("error", reject);
    req.end(init.body);
  });
}

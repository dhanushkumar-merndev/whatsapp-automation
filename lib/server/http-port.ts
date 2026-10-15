import "server-only";
import { assertSafeUrl, type UrlPolicy } from "@/lib/crm/ssrf";
import { safeRequest } from "@/lib/crm/safe-request";
import type { HttpPort } from "@/lib/engine/types";

/** "API request" step: public addresses only, no redirects, 64 KB reply cap. */
export function createHttpPort(policy: UrlPolicy): HttpPort {
  return {
    async request(input) {
      const url = await assertSafeUrl(input.url, policy);
      return safeRequest(url, {
        method: input.method,
        headers: { "User-Agent": "StarGrowthHub-Bot/1.0", Accept: "application/json", ...input.headers },
        body: input.body,
        timeoutMs: input.timeoutMs,
        policy,
        maxBytes: 64 * 1024,
      });
    },
  };
}

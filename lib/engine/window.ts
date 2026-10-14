import type { AppSettings } from "@/lib/settings/schema";

/**
 * Meta's customer-service window: free-form replies are allowed only within
 * 24 hours of the customer's latest inbound message. A safety margin closes
 * the window slightly early so a delayed send never lands outside it.
 */
export function windowExpiresAt(lastInboundAt: string | null, settings: AppSettings): Date | null {
  if (!lastInboundAt) return null;
  const t = new Date(lastInboundAt).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + settings.window.hours * 3_600_000 - settings.window.safetyMarginMinutes * 60_000);
}

export function isWindowOpen(lastInboundAt: string | null, now: Date, settings: AppSettings): boolean {
  const expires = windowExpiresAt(lastInboundAt, settings);
  return expires !== null && now.getTime() < expires.getTime();
}

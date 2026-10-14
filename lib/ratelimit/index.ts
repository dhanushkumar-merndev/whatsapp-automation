import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { createHash } from "node:crypto";

export interface LimitRule {
  /** Logical bucket, e.g. "inbound", "login". */
  prefix: string;
  tokens: number;
  windowSeconds: number;
}

export interface LimitResult {
  success: boolean;
  remaining: number;
  /** Unix ms when the window resets. */
  reset: number;
}

export interface RateLimiter {
  readonly kind: "upstash" | "memory";
  limit(identifier: string, rule: LimitRule): Promise<LimitResult>;
}

class UpstashLimiter implements RateLimiter {
  readonly kind = "upstash" as const;
  private readonly cache = new Map<string, Ratelimit>();
  constructor(private readonly redis: Redis) {}

  async limit(identifier: string, rule: LimitRule): Promise<LimitResult> {
    const key = `${rule.prefix}:${rule.tokens}:${rule.windowSeconds}`;
    let rl = this.cache.get(key);
    if (!rl) {
      rl = new Ratelimit({
        redis: this.redis,
        limiter: Ratelimit.slidingWindow(rule.tokens, `${rule.windowSeconds} s`),
        prefix: `sgh:rl:${rule.prefix}`,
        analytics: false,
      });
      this.cache.set(key, rl);
    }
    const r = await rl.limit(identifier);
    return { success: r.success, remaining: r.remaining, reset: r.reset };
  }
}

/** In-process limiter for tests and local development without Redis. */
export class MemoryLimiter implements RateLimiter {
  readonly kind = "memory" as const;
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly now: () => number = Date.now) {}

  async limit(identifier: string, rule: LimitRule): Promise<LimitResult> {
    const key = `${rule.prefix}:${identifier}`;
    const now = this.now();
    const windowStart = now - rule.windowSeconds * 1000;
    const list = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    const success = list.length < rule.tokens;
    if (success) list.push(now);
    this.hits.set(key, list);
    return { success, remaining: Math.max(0, rule.tokens - list.length), reset: (list[0] ?? now) + rule.windowSeconds * 1000 };
  }
}

let limiter: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (limiter) return limiter;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    limiter = new UpstashLimiter(new Redis({ url, token }));
  } else {
    if ((process.env.APP_ENV ?? "development") === "production") {
      throw new Error("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are required in production");
    }
    console.warn("[ratelimit] Upstash Redis not configured — using in-memory limiter (development only)");
    limiter = new MemoryLimiter();
  }
  return limiter;
}

export function setRateLimiterForTests(l: RateLimiter | null) {
  limiter = l;
}

/** Hash identifiers (IPs, emails) before storing them in security logs. */
export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value.toLowerCase()).digest("hex").slice(0, 24);
}

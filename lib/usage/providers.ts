import "server-only";

/**
 * Provider-reported usage where a supported API exists.
 * Upstash Developer API: daily Redis command counts (requires the optional
 * UPSTASH_MANAGEMENT_* variables). Returns null when not configured or on error —
 * callers must then label figures as local estimates.
 */
export async function fetchUpstashRedisStats(): Promise<{ dailyCommands: { day: string; count: number }[]; fetchedAt: string } | null> {
  const email = process.env.UPSTASH_MANAGEMENT_EMAIL;
  const key = process.env.UPSTASH_MANAGEMENT_API_KEY;
  const db = process.env.UPSTASH_REDIS_DATABASE_ID;
  if (!email || !key || !db) return null;
  try {
    const res = await fetch(`https://api.upstash.com/v2/redis/stats/${encodeURIComponent(db)}`, {
      headers: { Authorization: `Basic ${Buffer.from(`${email}:${key}`).toString("base64")}` },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { dailyrequests?: { x: string; y: number }[] };
    const daily = (body.dailyrequests ?? []).map((p) => ({ day: String(p.x).slice(0, 10), count: Number(p.y) || 0 }));
    return { dailyCommands: daily, fetchedAt: new Date().toISOString() };
  } catch {
    return null;
  }
}

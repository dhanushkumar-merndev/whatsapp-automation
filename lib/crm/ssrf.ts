import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF protection for outgoing CRM webhooks. Destinations must resolve only
 * to public addresses. The same check runs again at connect time (see
 * safe-request.ts), which also defeats DNS-rebinding.
 */

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function inV4Range(ip: string, base: string, bits: number) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

export function isLoopback(ip: string): boolean {
  if (isIP(ip) === 4) return inV4Range(ip, "127.0.0.0", 8);
  const v = ip.toLowerCase();
  return v === "::1" || v === "0:0:0:0:0:0:0:1" || (v.startsWith("::ffff:") && isLoopback(v.slice(7)));
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return V4_BLOCKED.some(([b, n]) => inV4Range(ip, b, n));
  if (family === 6) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateAddress(mapped[1]);
    const first = parseInt(v.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (v.startsWith("2001:db8:") || v.startsWith("64:ff9b:") || v.startsWith("100::")) return true;
    return false;
  }
  return true; // not an IP at all → treat as unsafe
}

export class UnsafeDestinationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeDestinationError";
  }
}

export interface UrlPolicy {
  requireHttps: boolean;
  /** Development only: allow http://localhost receivers for local testing. */
  allowLoopback: boolean;
}

export function checkUrlShape(raw: string, policy: UrlPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeDestinationError("Invalid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new UnsafeDestinationError("Only http(s) URLs are allowed");
  if (policy.requireHttps && url.protocol !== "https:") throw new UnsafeDestinationError("HTTPS is required in production");
  if (url.username || url.password) throw new UnsafeDestinationError("Credentials in the URL are not allowed; use the authentication settings");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const loopbackName = host === "localhost" || host.endsWith(".localhost");
  if (loopbackName && !policy.allowLoopback) throw new UnsafeDestinationError("Local addresses are not allowed");
  if (/\.(local|internal|lan|home|corp|intranet)$/.test(host)) throw new UnsafeDestinationError("Internal host names are not allowed");
  if (url.protocol === "http:" && !policy.allowLoopback) throw new UnsafeDestinationError("HTTPS is required");
  return url;
}

export function assertPublicAddress(ip: string, policy: UrlPolicy) {
  if (policy.allowLoopback && isLoopback(ip)) return;
  if (isPrivateAddress(ip)) throw new UnsafeDestinationError("Destination resolves to a private or reserved address");
}

/** Validates the URL and all of its DNS answers. */
export async function assertSafeUrl(raw: string, policy: UrlPolicy): Promise<URL> {
  const url = checkUrlShape(raw, policy);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!addresses.length) throw new UnsafeDestinationError("Destination host could not be resolved");
  for (const a of addresses) assertPublicAddress(a.address, policy);
  return url;
}

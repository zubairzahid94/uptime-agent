import dns from "node:dns/promises";
import { isIP } from "node:net";

export class SsrfBlockedError extends Error {
  constructor(url: string, reason: string) {
    super(`Blocked unsafe URL ${url}: ${reason}`);
    this.name = "SsrfBlockedError";
  }
}

function ipToLong(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function inRange(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  if (range === undefined || bitsStr === undefined) {
    throw new Error(`invalid CIDR: ${cidr}`);
  }
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
}

const BLOCKED_RANGES = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "127.0.0.0/8",
  "169.254.0.0/16",
];

export function isBlockedIp(ip: string): boolean {
  if (isIP(ip) !== 4) return true; // block anything not plain IPv4 (incl. IPv6) — not resolvable to a safe/unsafe judgment in v1
  return BLOCKED_RANGES.some((range) => inRange(ip, range));
}

export async function assertUrlIsSafe(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(rawUrl, "not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfBlockedError(rawUrl, `scheme ${parsed.protocol} not allowed`);
  }

  const literalIp = isIP(parsed.hostname);
  if (literalIp) {
    if (isBlockedIp(parsed.hostname)) {
      throw new SsrfBlockedError(rawUrl, "resolves to a blocked IP range");
    }
    return;
  }

  const results = await dns.lookup(parsed.hostname, { all: true });
  for (const { address, family } of results) {
    if (family !== 4 || isBlockedIp(address)) {
      throw new SsrfBlockedError(rawUrl, `hostname resolves to blocked address ${address}`);
    }
  }
}

export async function safeFetch(rawUrl: string, fetchImpl: typeof fetch = fetch, maxRedirects = 5): Promise<Response> {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertUrlIsSafe(currentUrl);
    const res = await fetchImpl(currentUrl, { redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new SsrfBlockedError(rawUrl, "too many redirects");
}

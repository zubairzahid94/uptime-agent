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

function isBlockedIpv4(ip: string): boolean {
  return BLOCKED_RANGES.some((range) => inRange(ip, range));
}

// Expands any valid IPv6 textual form (compressed "::", embedded dotted IPv4 tail)
// into its 8 numeric hextets. Comparing whole hextets rather than string prefixes
// matters because the WHATWG URL parser re-canonicalises literals: the hostname of
// `http://[::ffff:127.0.0.1]/` arrives here as "::ffff:7f00:1", so a match against
// the dotted form alone would silently miss IPv4-mapped loopback.
function expandIpv6(ip: string): number[] | null {
  let s = ip;

  const embeddedV4 = s.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (embeddedV4 && embeddedV4.index !== undefined) {
    const o = embeddedV4[1]!.split(".").map(Number);
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    s = s.slice(0, embeddedV4.index) + (((o[0]! << 8) | o[1]!).toString(16)) + ":" + (((o[2]! << 8) | o[3]!).toString(16));
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = (halves[0] ?? "").split(":").filter(Boolean).map((h) => parseInt(h, 16));
  const tail = halves.length === 2 ? (halves[1] ?? "").split(":").filter(Boolean).map((h) => parseInt(h, 16)) : [];
  const fill = 8 - head.length - tail.length;
  if (fill < 0 || (halves.length === 1 && fill !== 0)) return null;
  const hextets = [...head, ...new Array<number>(fill).fill(0), ...tail];
  if (hextets.length !== 8 || hextets.some((h) => !Number.isInteger(h) || h < 0 || h > 0xffff)) return null;
  return hextets;
}

function isBlockedIpv6(ip: string): boolean {
  const h = expandIpv6(ip.toLowerCase());
  if (h === null) return true; // couldn't expand it - fail closed

  // ::1 loopback and :: unspecified
  if (h.slice(0, 7).every((x) => x === 0) && (h[7] === 0 || h[7] === 1)) return true;

  // ::ffff:0:0/96 IPv4-mapped - judge the address it actually wraps
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    return isBlockedIpv4(`${h[6]! >> 8}.${h[6]! & 0xff}.${h[7]! >> 8}.${h[7]! & 0xff}`);
  }

  const first = h[0]!;
  if (first >= 0xfc00 && first <= 0xfdff) return true; // fc00::/7 unique local (equivalent to RFC1918 private)
  if (first >= 0xfe80 && first <= 0xfebf) return true; // fe80::/10 link-local (equivalent to 169.254.0.0/16)

  return false;
}

export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true; // couldn't parse as a real IP at all - fail closed
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

  // URL.hostname keeps the brackets on an IPv6 literal (http://[::1]/ -> "[::1]"),
  // which isIP() does not recognise — strip them so literals of both families take
  // the literal-IP path instead of falling through to a doomed DNS lookup.
  const hostname = parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
    ? parsed.hostname.slice(1, -1)
    : parsed.hostname;

  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new SsrfBlockedError(rawUrl, "resolves to a blocked IP range");
    }
    return;
  }

  let results: Array<{ address: string }>;
  try {
    results = await dns.lookup(hostname, { all: true });
  } catch (err) {
    // A raw Node DNS error (ENOTFOUND on a typo'd domain, EAI_AGAIN on a resolver
    // hiccup) would propagate as a generic Error; callers distinguish on error TYPE
    // to decide what to tell the user, so fail closed as an SsrfBlockedError.
    const reason = err instanceof Error ? err.message : String(err);
    throw new SsrfBlockedError(rawUrl, `could not resolve hostname (${reason})`);
  }

  // Fail closed if ANY resolved record is unsafe, regardless of family: undici's
  // Happy Eyeballs may connect over any of the addresses returned here.
  for (const { address } of results) {
    if (isBlockedIp(address)) {
      throw new SsrfBlockedError(rawUrl, `hostname resolves to blocked address ${address}`);
    }
  }
}

/**
 * Releases a response body we are never going to read, so its socket isn't held
 * open. Safe to call on an already-consumed, absent, or mock body.
 */
export function drainBody(res: Pick<Response, "body">): void {
  try {
    void res.body?.cancel().catch(() => {});
  } catch {
    // a locked/disturbed body throws synchronously; nothing to release
  }
}

export async function safeFetch(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
  maxRedirects = 5,
  init: Omit<RequestInit, "redirect"> = {},
): Promise<Response> {
  let currentUrl = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertUrlIsSafe(currentUrl);
    // `redirect: "manual"` is fixed, not caller-overridable: following redirects
    // automatically would skip the per-hop assertUrlIsSafe check below.
    const res = await fetchImpl(currentUrl, { ...init, redirect: "manual" });
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return res;
    // The redirect response's body is never read, and an unread body holds its socket
    // open until GC. Drain it before moving to the next hop.
    drainBody(res);
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new SsrfBlockedError(rawUrl, "too many redirects");
}

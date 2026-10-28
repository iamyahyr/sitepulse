import ipaddr from "ipaddr.js";

/**
 * SSRF guard: decides which URLs and IP addresses the prober may touch.
 *
 * Policy is an allowlist: only globally routable unicast addresses pass.
 * Everything else (loopback, RFC 1918, link-local, CGNAT, ULA, multicast,
 * reserved, NAT64/6to4/Teredo tunnels that can embed a private IPv4…) is
 * rejected unless the operator explicitly allows a CIDR. Cloud metadata
 * endpoints are blocked unconditionally.
 */

export type GuardOptions = {
  /** CIDRs a self-hoster explicitly wants to reach, e.g. ["192.168.1.0/24"]. */
  allowPrivateCidrs?: readonly string[];
};

export type UrlRejection =
  | "INVALID_URL"
  | "UNSUPPORTED_PROTOCOL"
  | "CREDENTIALS_IN_URL"
  | "BLOCKED_HOSTNAME"
  | "BLOCKED_ADDRESS";

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: UrlRejection };

const METADATA_ADDRESSES = new Set(["169.254.169.254", "169.254.170.2", "fd00:ec2::254", "100.100.100.200"]);

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

type ParsedCidr = [ipaddr.IPv4 | ipaddr.IPv6, number];

const cidrCache = new Map<string, ParsedCidr[]>();

function parseCidrs(cidrs: readonly string[]): ParsedCidr[] {
  const key = cidrs.join(",");
  let parsed = cidrCache.get(key);
  if (!parsed) {
    parsed = cidrs.map((c) => ipaddr.parseCIDR(c.trim()));
    cidrCache.set(key, parsed);
  }
  return parsed;
}

/** Whether `cidr` is an "address/prefix" range, so configuration can be rejected at startup instead of mid-probe. */
export function isValidCidr(cidr: string): boolean {
  try {
    ipaddr.parseCIDR(cidr.trim());
    return true;
  } catch {
    return false;
  }
}

/** Unwraps IPv4-mapped IPv6 (::ffff:a.b.c.d) so it is judged as the IPv4 it really is. */
function normalize(address: string): ipaddr.IPv4 | ipaddr.IPv6 {
  const parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    return (parsed as ipaddr.IPv6).toIPv4Address();
  }
  return parsed;
}

export function isBlockedAddress(address: string, options: GuardOptions = {}): boolean {
  if (!ipaddr.isValid(address)) return true;
  const ip = normalize(address);

  if (METADATA_ADDRESSES.has(ip.toString())) return true;

  if (ip.range() === "unicast") return false;

  const allowed = parseCidrs(options.allowPrivateCidrs ?? []);
  return !allowed.some(([range, bits]) => range.kind() === ip.kind() && ip.match(range, bits));
}

export function checkUrl(raw: string, options: GuardOptions = {}): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "INVALID_URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "UNSUPPORTED_PROTOCOL" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "CREDENTIALS_IN_URL" };
  }

  // WHATWG URL already canonicalizes exotic IPv4 forms (2130706433, 0x7f.1,
  // 017700000001…) to dotted decimal, so literal checks below see the real IP.
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (ipaddr.isValid(host)) {
    return isBlockedAddress(host, options) ? { ok: false, reason: "BLOCKED_ADDRESS" } : { ok: true, url };
  }

  // Name-based rejections are only an early, friendly error: the real check
  // happens on every resolved address. Once an operator allows private
  // ranges, internal names (Docker services, "nas", *.local) are legitimate
  // and the resolved IP still has to fall inside an allowed range.
  const allowsPrivate = (options.allowPrivateCidrs?.length ?? 0) > 0;
  if (
    !allowsPrivate &&
    (host === "localhost" || !host.includes(".") || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)))
  ) {
    return { ok: false, reason: "BLOCKED_HOSTNAME" };
  }

  return { ok: true, url };
}

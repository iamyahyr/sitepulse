import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import type { TLSSocket } from "node:tls";
import { classifyNodeError, statusErrorCode, type ErrorCode } from "./diagnosis";
import { checkUrl, isBlockedAddress, type GuardOptions } from "./ssrf-guard";
import { DEFAULT_EXPECTED_STATUS, matchesExpectedStatus } from "./status";

/**
 * HTTP(S) prober with per-phase timings.
 *
 * DNS is resolved here, every returned address is validated against the SSRF
 * guard, and the socket is then pinned to the validated address through a
 * custom `lookup`. Node never resolves the hostname a second time, so a DNS
 * rebinding answer cannot swap the target between validation and connection.
 * Redirects are followed manually and each hop goes through the same checks.
 */

export type ResolvedAddress = { address: string; family: 4 | 6 };
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export type ProbeOptions = {
  /** Budget for the whole probe, redirects included. */
  timeoutMs?: number;
  maxRedirects?: number;
  /** Bytes of body to read before hanging up. The body is never stored. */
  maxBodyBytes?: number;
  expectedStatus?: string;
  guard?: GuardOptions;
  resolver?: Resolver;
  userAgent?: string;
  /** Extra trusted CA, only meant for tests. */
  ca?: string | Buffer;
};

export type PhaseTimings = {
  dns: number | null;
  connect: number | null;
  tls: number | null;
  ttfb: number | null;
  download: number | null;
  total: number;
};

export type ProbeResult = {
  ok: boolean;
  status: number | null;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  timings: PhaseTimings;
  resolvedIp: string | null;
  redirects: number;
  finalUrl: string;
  bodyBytes: number;
  tlsValidTo: Date | null;
};

export const PROBE_DEFAULTS = {
  timeoutMs: 10_000,
  maxRedirects: 5,
  maxBodyBytes: 256 * 1024,
  userAgent: "SitePulse/0.1 (+https://github.com/iamyahyr/sitepulse)",
} as const;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type Phase = "connect" | "tls" | "ttfb" | "body";

const TIMEOUT_CODES: Record<Phase, ErrorCode> = {
  connect: "TCP_TIMEOUT",
  tls: "TLS_TIMEOUT",
  ttfb: "TTFB_TIMEOUT",
  body: "BODY_TIMEOUT",
};

type HopOutcome = {
  status: number | null;
  location: string | null;
  connect: number | null;
  tls: number | null;
  ttfb: number | null;
  download: number | null;
  bodyBytes: number;
  tlsValidTo: Date | null;
  error: { code: ErrorCode; message: string } | null;
};

/**
 * Default resolver: c-ares (`dns.Resolver`), not `dns.lookup`. `lookup` runs
 * getaddrinfo on libuv's 4-thread pool and cannot be cancelled, so when DNS
 * hangs a few stuck lookups would block every other probe (and all file I/O).
 * c-ares is asynchronous with its own timeout. It uses the system nameservers
 * but not /etc/hosts, which is right for monitoring public sites.
 */
const resolver = new dns.Resolver({ timeout: 3_000, tries: 2 });

export const systemResolver: Resolver = async (hostname) => {
  const [v4, v6] = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
  const records: ResolvedAddress[] = [
    ...(v4.status === "fulfilled" ? v4.value.map((address) => ({ address, family: 4 as const })) : []),
    ...(v6.status === "fulfilled" ? v6.value.map((address) => ({ address, family: 6 as const })) : []),
  ];
  if (records.length === 0 && v4.status === "rejected") throw v4.reason;
  return records;
};

/** DNS failures get DNS codes, even when the resolver's error looks like a socket one. */
function classifyDnsError(err: unknown): ErrorCode {
  const code = (err as { code?: string } | null)?.code ?? "";
  if (code === "ENOTFOUND" || code === "ENODATA" || code === "NXDOMAIN") return "DNS_NOT_FOUND";
  if (code === "ETIMEOUT" || code === "ETIMEDOUT") return "DNS_TIMEOUT";
  return "DNS_FAILED";
}

const now = () => performance.now();
const ms = (from: number | undefined, to: number | undefined) =>
  from === undefined || to === undefined ? null : Math.round(to - from);

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | "timeout"> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export type Resolution =
  | { ok: true; target: ResolvedAddress; dnsMs: number | null }
  | { ok: false; code: ErrorCode; message: string; dnsMs: number | null };

export async function resolveTarget(
  url: URL,
  resolver: Resolver,
  guard: GuardOptions,
  budgetMs: number,
): Promise<Resolution> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host);
  if (literal) return { ok: true, target: { address: host, family: literal === 6 ? 6 : 4 }, dnsMs: null };

  const started = now();
  let records: ResolvedAddress[] | "timeout";
  try {
    records = await withTimeout(resolver(host), budgetMs);
  } catch (err) {
    return { ok: false, code: classifyDnsError(err), message: (err as Error).message, dnsMs: ms(started, now()) };
  }
  const dnsMs = Math.round(now() - started);

  if (records === "timeout") return { ok: false, code: "DNS_TIMEOUT", message: "DNS lookup timed out", dnsMs };
  if (records.length === 0) return { ok: false, code: "DNS_NOT_FOUND", message: "No A/AAAA records", dnsMs };

  // Reject the whole answer if any address is internal: a legitimate public
  // site has no reason to publish one, and an attacker mixing them is exactly
  // the case we want to stop.
  const blocked = records.find((r) => isBlockedAddress(r.address, guard));
  if (blocked) {
    return { ok: false, code: "BLOCKED_ADDRESS", message: `${host} resolves to ${blocked.address}`, dnsMs };
  }

  // Prefer IPv4: plenty of VPSes have no IPv6 route, which would read as an outage.
  const target = records.find((r) => r.family === 4) ?? records[0]!;
  return { ok: true, target, dnsMs };
}

function requestOnce(
  url: URL,
  target: ResolvedAddress,
  budgetMs: number,
  options: Required<Pick<ProbeOptions, "maxBodyBytes" | "userAgent">> & Pick<ProbeOptions, "ca">,
): Promise<HopOutcome> {
  return new Promise((resolve) => {
    const isHttps = url.protocol === "https:";
    const started = now();
    let connectAt: number | undefined;
    let secureAt: number | undefined;
    let responseAt: number | undefined;
    let phase: Phase = "connect";
    let status: number | null = null;
    let location: string | null = null;
    let bodyBytes = 0;
    let tlsValidTo: Date | null = null;
    let settled = false;

    const pinnedLookup: LookupFunction = (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) callback(null, [target]);
      else callback(null, target.address, target.family);
    };

    const finish = (error: HopOutcome["error"]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const end = now();
      resolve({
        status,
        location,
        connect: ms(started, connectAt),
        tls: isHttps ? ms(connectAt, secureAt) : null,
        ttfb: ms(isHttps ? secureAt : connectAt, responseAt),
        download: responseAt === undefined || error ? null : Math.round(end - responseAt),
        bodyBytes,
        tlsValidTo,
        error,
      });
      req.destroy();
    };

    const fail = (err: unknown) => {
      let code = classifyNodeError(err);
      if (phase === "tls" && (code === "UNKNOWN" || code === "TCP_RESET")) code = "TLS_HANDSHAKE_FAILED";
      if (phase === "body" && code === "UNKNOWN") code = "BODY_TIMEOUT";
      finish({ code, message: (err as Error).message ?? String(err) });
    };

    const req = (isHttps ? https : http).request(url, {
      method: "GET",
      agent: false,
      lookup: pinnedLookup,
      ca: options.ca,
      headers: {
        "user-agent": options.userAgent,
        accept: "*/*",
        "accept-encoding": "identity",
        "cache-control": "no-cache",
      },
    });

    const timer = setTimeout(() => {
      finish({ code: TIMEOUT_CODES[phase], message: `Timed out after ${Math.round(now() - started)} ms (${phase})` });
    }, budgetMs);

    req.on("socket", (socket) => {
      socket.once("connect", () => {
        connectAt = now();
        phase = isHttps ? "tls" : "ttfb";
      });
      socket.once("secureConnect", () => {
        secureAt = now();
        phase = "ttfb";
        const cert = (socket as TLSSocket).getPeerCertificate();
        if (cert?.valid_to) tlsValidTo = new Date(cert.valid_to);
      });
    });

    req.on("response", (res) => {
      responseAt = now();
      phase = "body";
      status = res.statusCode ?? null;
      if (status !== null && REDIRECT_STATUSES.has(status) && res.headers.location) {
        location = res.headers.location;
        finish(null);
        return;
      }
      res.on("data", (chunk: Buffer) => {
        bodyBytes += chunk.length;
        if (bodyBytes >= options.maxBodyBytes) finish(null);
      });
      res.on("end", () => finish(null));
      res.on("error", fail);
    });

    req.on("error", fail);
    req.end();
  });
}

export async function probe(rawUrl: string, options: ProbeOptions = {}): Promise<ProbeResult> {
  const timeoutMs = options.timeoutMs ?? PROBE_DEFAULTS.timeoutMs;
  const maxRedirects = options.maxRedirects ?? PROBE_DEFAULTS.maxRedirects;
  const guard = options.guard ?? {};
  const resolver = options.resolver ?? systemResolver;
  const hopOptions = {
    maxBodyBytes: options.maxBodyBytes ?? PROBE_DEFAULTS.maxBodyBytes,
    userAgent: options.userAgent ?? PROBE_DEFAULTS.userAgent,
    ca: options.ca,
  };

  const started = now();
  const deadline = started + timeoutMs;
  let redirects = 0;
  let currentUrl = rawUrl;

  const result = (partial: Partial<ProbeResult> & Pick<ProbeResult, "ok">): ProbeResult => ({
    status: null,
    errorCode: null,
    errorMessage: null,
    resolvedIp: null,
    bodyBytes: 0,
    tlsValidTo: null,
    ...partial,
    timings: { dns: null, connect: null, tls: null, ttfb: null, download: null, ...partial.timings, total: Math.round(now() - started) },
    redirects,
    finalUrl: currentUrl,
  });

  const initial = checkUrl(rawUrl, guard);
  if (!initial.ok) {
    return result({ ok: false, errorCode: "BLOCKED_URL", errorMessage: initial.reason });
  }
  let url = initial.url;

  for (;;) {
    currentUrl = url.href;
    const resolution = await resolveTarget(url, resolver, guard, Math.max(0, deadline - now()));
    if (!resolution.ok) {
      return result({
        ok: false,
        errorCode: resolution.code,
        errorMessage: resolution.message,
        timings: { dns: resolution.dnsMs } as PhaseTimings,
      });
    }

    const remaining = deadline - now();
    if (remaining <= 0) {
      return result({ ok: false, errorCode: "TCP_TIMEOUT", errorMessage: "Probe budget exhausted" });
    }

    const hop = await requestOnce(url, resolution.target, remaining, hopOptions);
    const common = {
      status: hop.status,
      resolvedIp: resolution.target.address,
      bodyBytes: hop.bodyBytes,
      tlsValidTo: hop.tlsValidTo,
      timings: {
        dns: resolution.dnsMs,
        connect: hop.connect,
        tls: hop.tls,
        ttfb: hop.ttfb,
        download: hop.download,
      } as PhaseTimings,
    };

    if (hop.error) {
      return result({ ...common, ok: false, errorCode: hop.error.code, errorMessage: hop.error.message });
    }

    if (hop.location !== null) {
      if (redirects >= maxRedirects) {
        return result({ ...common, ok: false, errorCode: "TOO_MANY_REDIRECTS", errorMessage: `More than ${maxRedirects} redirects` });
      }
      let next: URL;
      try {
        next = new URL(hop.location, url);
      } catch {
        return result({ ...common, ok: false, errorCode: "INVALID_REDIRECT", errorMessage: `Unparseable Location: ${hop.location}` });
      }
      const nextCheck = checkUrl(next.href, guard);
      if (!nextCheck.ok) {
        return result({ ...common, ok: false, errorCode: "INVALID_REDIRECT", errorMessage: `Redirect to ${next.href} (${nextCheck.reason})` });
      }
      redirects++;
      url = nextCheck.url;
      continue;
    }

    const status = hop.status ?? 0;
    if (matchesExpectedStatus(status, options.expectedStatus ?? DEFAULT_EXPECTED_STATUS)) {
      return result({ ...common, ok: true });
    }
    return result({ ...common, ok: false, errorCode: statusErrorCode(status), errorMessage: `HTTP ${status}` });
  }
}

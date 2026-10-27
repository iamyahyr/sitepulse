import net from "node:net";
import type { ErrorCode } from "./diagnosis";
import { systemResolver, type ProbeResult } from "./probe";

/**
 * Self-connectivity guard.
 *
 * If the monitor's own server loses its network or DNS, every site would fail
 * at once and look "down". Before a network-layer failure is held against a
 * site, the worker asks this monitor whether *it* can still reach the
 * internet, using canaries: TCP connects to very stable anycast IPs (no DNS
 * needed) and lookups of well-known names.
 *
 * Results are cached briefly and shared between concurrent callers, so an
 * outage costs one round of canaries, not one per site.
 */

export type Connectivity = {
  /** Can reach the internet at the TCP level. */
  network: boolean;
  /** Can resolve public names. Meaningless when `network` is false. */
  dns: boolean;
};

export type ConnectivityState = {
  offlineSince: Date | null;
  reason: "network" | "dns" | null;
};

export type ConnectivityChecks = {
  tcp: (host: string, port: number, timeoutMs: number) => Promise<boolean>;
  dns: (name: string) => Promise<boolean>;
};

export type ConnectivityOptions = {
  /** "host:port" pairs with literal IPs. Empty disables the network canary. */
  tcpTargets: readonly string[];
  /** Public names to resolve. Empty disables the DNS canary. */
  dnsNames: readonly string[];
  cacheMs?: number;
  timeoutMs?: number;
  /**
   * A real site answering this recently proves connectivity even if every
   * canary is blocked (e.g. by an egress firewall), so a misconfigured canary
   * can never silently hide genuine outages for long.
   */
  recentEvidenceMs?: number;
  checks?: Partial<ConnectivityChecks>;
  now?: () => number;
};

export const DEFAULT_TCP_CANARIES = ["1.1.1.1:443", "8.8.8.8:443", "9.9.9.9:443"];
export const DEFAULT_DNS_CANARIES = ["cloudflare.com", "google.com", "quad9.net"];

/** Failures that can be caused by the monitor's own network rather than the site. */
const NETWORK_LAYER: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "DNS_NOT_FOUND",
  "DNS_TIMEOUT",
  "DNS_FAILED",
  "TCP_REFUSED",
  "TCP_TIMEOUT",
  "TCP_RESET",
  "NETWORK_UNREACHABLE",
  "TLS_TIMEOUT",
  "TLS_HANDSHAKE_FAILED",
  "TTFB_TIMEOUT",
  "BODY_TIMEOUT",
]);

export function isNetworkLayerFailure(code: ErrorCode | null): boolean {
  return code !== null && NETWORK_LAYER.has(code);
}

/** Whether a failure says more about the monitor than about the site. */
export function isSuppressed(code: ErrorCode | null, connectivity: Connectivity): boolean {
  if (!isNetworkLayerFailure(code)) return false;
  if (!connectivity.network) return true;
  return !connectivity.dns && code!.startsWith("DNS_");
}

const tcpConnect: ConnectivityChecks["tcp"] = (host, port, timeoutMs) =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });

const dnsResolves: ConnectivityChecks["dns"] = async (name) => {
  try {
    return (await systemResolver(name)).length > 0;
  } catch {
    return false;
  }
};

async function any(checks: Promise<boolean>[]): Promise<boolean> {
  if (checks.length === 0) return true;
  try {
    return await Promise.any(checks.map((p) => p.then((ok) => (ok ? true : Promise.reject()))));
  } catch {
    return false;
  }
}

export class ConnectivityMonitor {
  private readonly tcpTargets: { host: string; port: number }[];
  private readonly cacheMs: number;
  private readonly timeoutMs: number;
  private readonly recentEvidenceMs: number;
  private readonly checks: ConnectivityChecks;
  private readonly now: () => number;

  private cached: { at: number; value: Connectivity } | null = null;
  private inFlight: Promise<Connectivity> | null = null;
  private lastResponseAt = -Infinity;
  private lastDnsOkAt = -Infinity;
  private current: ConnectivityState = { offlineSince: null, reason: null };

  constructor(private readonly options: ConnectivityOptions) {
    this.tcpTargets = options.tcpTargets.map((target) => {
      const [host, port] = target.split(/:(?=\d+$)/);
      return { host: host!.replace(/^\[|\]$/g, ""), port: Number(port ?? 443) };
    });
    this.cacheMs = options.cacheMs ?? 15_000;
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.recentEvidenceMs = options.recentEvidenceMs ?? 30_000;
    this.checks = { tcp: tcpConnect, dns: dnsResolves, ...options.checks };
    this.now = options.now ?? Date.now;
  }

  get state(): ConnectivityState {
    return this.current;
  }

  /** Feed every probe result in: a site that answered proves we are online. */
  noteProbe(result: ProbeResult) {
    const at = this.now();
    const responded = result.status !== null;
    const resolved = result.resolvedIp !== null && result.timings.dns !== null;
    if (responded) this.lastResponseAt = at;
    if (resolved) this.lastDnsOkAt = at;
    // Evidence we are back: forget the cached verdict and re-measure, so
    // neither suppression nor the "offline" banner outlives the outage.
    if ((responded || resolved) && this.current.offlineSince) {
      this.cached = null;
      void this.status();
    }
  }

  async status(): Promise<Connectivity> {
    if (this.cached && this.now() - this.cached.at < this.cacheMs) return this.cached.value;
    this.inFlight ??= this.measure().finally(() => (this.inFlight = null));
    return this.inFlight;
  }

  private async measure(): Promise<Connectivity> {
    const started = this.now();
    const [tcpOk, dnsOk] = await Promise.all([
      any(this.tcpTargets.map(({ host, port }) => this.checks.tcp(host, port, this.timeoutMs))),
      any(this.options.dnsNames.map((name) => this.checks.dns(name))),
    ]);
    const now = this.now();
    const value: Connectivity = {
      network: tcpOk || now - this.lastResponseAt <= this.recentEvidenceMs,
      dns: dnsOk || now - this.lastDnsOkAt <= this.recentEvidenceMs,
    };
    this.cached = { at: started, value };
    this.update(value);
    return value;
  }

  private update(value: Connectivity) {
    const reason = !value.network ? "network" : !value.dns ? "dns" : null;
    if (reason === null) this.current = { offlineSince: null, reason: null };
    else this.current = { offlineSince: this.current.offlineSince ?? new Date(this.now()), reason };
  }
}

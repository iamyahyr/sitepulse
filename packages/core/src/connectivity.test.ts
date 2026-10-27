import net from "node:net";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { ConnectivityMonitor, isSuppressed, type ConnectivityChecks } from "./connectivity";
import type { ProbeResult } from "./probe";

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function monitor(checks: Partial<ConnectivityChecks>, extra: { now?: () => number } = {}) {
  return new ConnectivityMonitor({
    tcpTargets: ["1.1.1.1:443", "8.8.8.8:443"],
    dnsNames: ["cloudflare.com"],
    checks,
    ...extra,
  });
}

const result = (partial: Partial<ProbeResult>): ProbeResult => ({
  ok: false,
  status: null,
  errorCode: null,
  errorMessage: null,
  timings: { dns: null, connect: null, tls: null, ttfb: null, download: null, total: 1 },
  resolvedIp: null,
  redirects: 0,
  finalUrl: "https://example.com/",
  bodyBytes: 0,
  tlsValidTo: null,
  ...partial,
});

describe("isSuppressed", () => {
  const online = { network: true, dns: true };
  const offline = { network: false, dns: false };
  const noDns = { network: true, dns: false };

  it("never suppresses anything while online", () => {
    expect(isSuppressed("TCP_TIMEOUT", online)).toBe(false);
    expect(isSuppressed("DNS_TIMEOUT", online)).toBe(false);
  });

  it("suppresses every network-layer failure while offline", () => {
    for (const code of ["DNS_TIMEOUT", "DNS_NOT_FOUND", "TCP_TIMEOUT", "TCP_REFUSED", "NETWORK_UNREACHABLE", "TLS_TIMEOUT", "TTFB_TIMEOUT"] as const) {
      expect(isSuppressed(code, offline)).toBe(true);
    }
  });

  it("only suppresses DNS failures when just DNS is broken", () => {
    expect(isSuppressed("DNS_FAILED", noDns)).toBe(true);
    expect(isSuppressed("TCP_REFUSED", noDns)).toBe(false);
  });

  it("never suppresses failures that prove the site answered", () => {
    for (const code of ["HTTP_5XX", "HTTP_4XX", "TLS_CERT_EXPIRED", "TLS_HOSTNAME_MISMATCH", "TOO_MANY_REDIRECTS", "BLOCKED_ADDRESS"] as const) {
      expect(isSuppressed(code, offline)).toBe(false);
    }
    expect(isSuppressed(null, offline)).toBe(false);
  });
});

describe("ConnectivityMonitor", () => {
  it("is online when any canary of each kind succeeds", async () => {
    const m = monitor({ tcp: async (host) => host === "8.8.8.8", dns: async () => true });
    expect(await m.status()).toEqual({ network: true, dns: true });
    expect(m.state).toEqual({ offlineSince: null, reason: null });
  });

  it("reports a network outage and since when", async () => {
    const c = clock();
    const m = monitor({ tcp: async () => false, dns: async () => false }, { now: c.now });
    expect(await m.status()).toEqual({ network: false, dns: false });
    expect(m.state).toEqual({ offlineSince: new Date(c.now()), reason: "network" });
  });

  it("tells a DNS-only outage apart", async () => {
    const m = monitor({ tcp: async () => true, dns: async () => false });
    expect(await m.status()).toEqual({ network: true, dns: false });
    expect(m.state.reason).toBe("dns");
  });

  it("caches the verdict and shares one measurement between concurrent callers", async () => {
    const c = clock();
    let calls = 0;
    const m = monitor(
      {
        tcp: async () => {
          calls++;
          return true;
        },
        dns: async () => true,
      },
      { now: c.now },
    );
    await Promise.all([m.status(), m.status(), m.status()]);
    expect(calls).toBe(2); // one round, two TCP targets
    c.advance(10_000);
    await m.status();
    expect(calls).toBe(2);
    c.advance(10_000);
    await m.status();
    expect(calls).toBe(4);
  });

  it("trusts a recent real response over blocked canaries", async () => {
    const c = clock();
    const m = monitor({ tcp: async () => false, dns: async () => false }, { now: c.now });
    m.noteProbe(result({ status: 200, resolvedIp: "93.184.215.14", timings: { dns: 5, connect: 1, tls: 1, ttfb: 1, download: 1, total: 9 } }));
    c.advance(5_000);
    expect(await m.status()).toEqual({ network: true, dns: true });

    // …but that evidence expires, so a real outage is still detected.
    c.advance(60_000);
    expect((await m.status()).network).toBe(false);
  });

  it("clears the offline state as soon as a site answers again", async () => {
    const c = clock();
    let up = false;
    const m = monitor({ tcp: async () => up, dns: async () => up }, { now: c.now });
    await m.status();
    expect(m.state.reason).toBe("network");

    up = true;
    m.noteProbe(result({ status: 200 }));
    await m.status();
    expect(m.state).toEqual({ offlineSince: null, reason: null });
  });

  it("is always online when no canaries are configured", async () => {
    const m = new ConnectivityMonitor({ tcpTargets: [], dnsNames: [] });
    expect(await m.status()).toEqual({ network: true, dns: true });
  });

  it("really connects over TCP", async () => {
    const server = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const reachable = new ConnectivityMonitor({ tcpTargets: [`127.0.0.1:${port}`], dnsNames: [] });
      expect((await reachable.status()).network).toBe(true);
      server.close();
      const closed = new ConnectivityMonitor({ tcpTargets: [`127.0.0.1:${port}`], dnsNames: [], timeoutMs: 500 });
      expect((await closed.status()).network).toBe(false);
    } finally {
      server.close();
    }
  });
});

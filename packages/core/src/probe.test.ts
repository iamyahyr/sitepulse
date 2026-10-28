import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probe, type ProbeOptions, type Resolver } from "./probe";

type Handler = http.RequestListener;

const servers: (http.Server | https.Server)[] = [];

async function listen(server: http.Server | https.Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

const serve = (handler: Handler) => listen(http.createServer(handler));

// Every *.test hostname resolves to loopback, which the tests explicitly allow.
const loopbackResolver: Resolver = async () => [{ address: "127.0.0.1", family: 4 }];
const base: ProbeOptions = {
  resolver: loopbackResolver,
  guard: { allowPrivateCidrs: ["127.0.0.0/8"] },
  timeoutMs: 2_000,
};

afterAll(() => {
  for (const server of servers) server.close();
});

describe("probe over HTTP", () => {
  it("succeeds and reports phase timings", async () => {
    const port = await serve((_req, res) => res.end("ok"));
    const result = await probe(`http://site.test:${port}/`, base);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.errorCode).toBeNull();
    expect(result.resolvedIp).toBe("127.0.0.1");
    expect(result.timings.dns).not.toBeNull();
    expect(result.timings.connect).not.toBeNull();
    expect(result.timings.tls).toBeNull();
    expect(result.timings.ttfb).not.toBeNull();
    expect(result.timings.download).not.toBeNull();
    expect(result.bodyBytes).toBe(2);
  });

  it("measures server think time as TTFB", async () => {
    const port = await serve((_req, res) => setTimeout(() => res.end("slow"), 150));
    const result = await probe(`http://site.test:${port}/`, base);
    expect(result.ok).toBe(true);
    expect(result.timings.ttfb).toBeGreaterThanOrEqual(140);
  });

  it.each([
    [503, "HTTP_5XX"],
    [502, "HTTP_5XX"],
    [404, "HTTP_4XX"],
  ])("classifies status %i as %s", async (status, code) => {
    const port = await serve((_req, res) => {
      res.statusCode = status;
      res.end();
    });
    const result = await probe(`http://site.test:${port}/`, base);
    expect(result).toMatchObject({ ok: false, status, errorCode: code });
  });

  it("honours a custom expected status", async () => {
    const port = await serve((_req, res) => {
      res.statusCode = 401;
      res.end();
    });
    const result = await probe(`http://site.test:${port}/`, { ...base, expectedStatus: "200-299,401" });
    expect(result.ok).toBe(true);
  });

  it("follows redirects", async () => {
    const port = await serve((req, res) => {
      if (req.url === "/a") return res.writeHead(301, { location: "/b" }).end();
      if (req.url === "/b") return res.writeHead(302, { location: `http://other.test:${port}/c` }).end();
      res.end("done");
    });
    const result = await probe(`http://site.test:${port}/a`, base);
    expect(result).toMatchObject({ ok: true, status: 200, redirects: 2, finalUrl: `http://other.test:${port}/c` });
  });

  it("stops redirect loops", async () => {
    const port = await serve((_req, res) => res.writeHead(302, { location: "/" }).end());
    const result = await probe(`http://site.test:${port}/`, base);
    expect(result).toMatchObject({ ok: false, errorCode: "TOO_MANY_REDIRECTS", redirects: 5 });
  });

  it("refuses redirects to cloud metadata", async () => {
    const port = await serve((_req, res) =>
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end(),
    );
    const result = await probe(`http://site.test:${port}/`, base);
    expect(result.errorCode).toBe("INVALID_REDIRECT");
  });

  it("refuses redirects to non-http schemes", async () => {
    const port = await serve((_req, res) => res.writeHead(302, { location: "file:///etc/passwd" }).end());
    const result = await probe(`http://site.test:${port}/`, base);
    expect(result.errorCode).toBe("INVALID_REDIRECT");
  });

  it("stops reading after the body limit without failing", async () => {
    const port = await serve((_req, res) => {
      const chunk = Buffer.alloc(64 * 1024, "a");
      const write = () => {
        while (res.write(chunk)) {
          /* keep streaming forever */
        }
        res.once("drain", write);
      };
      write();
    });
    const result = await probe(`http://site.test:${port}/`, { ...base, maxBodyBytes: 100_000 });
    expect(result.ok).toBe(true);
    expect(result.bodyBytes).toBeGreaterThanOrEqual(100_000);
    expect(result.bodyBytes).toBeLessThan(1_000_000);
  });

  it("reports a server that never answers as TTFB_TIMEOUT", async () => {
    const port = await serve(() => {
      /* hang */
    });
    const result = await probe(`http://site.test:${port}/`, { ...base, timeoutMs: 300 });
    expect(result.errorCode).toBe("TTFB_TIMEOUT");
    expect(result.timings.connect).not.toBeNull();
  });

  it("reports a stalled body as BODY_TIMEOUT", async () => {
    const port = await serve((_req, res) => {
      res.writeHead(200, { "content-length": "1000" });
      res.write("partial");
    });
    const result = await probe(`http://site.test:${port}/`, { ...base, timeoutMs: 300 });
    expect(result.errorCode).toBe("BODY_TIMEOUT");
    expect(result.status).toBe(200);
  });

  it("reports a closed port as TCP_REFUSED", async () => {
    const port = await serve(() => {});
    await new Promise((resolve) => servers.pop()!.close(resolve));
    const result = await probe(`http://site.test:${port}/`, base);
    expect(result.errorCode).toBe("TCP_REFUSED");
  });
});

describe("probe DNS and SSRF handling", () => {
  it("maps NXDOMAIN to DNS_NOT_FOUND", async () => {
    const resolver: Resolver = async () => {
      throw Object.assign(new Error("getaddrinfo ENOTFOUND nope.test"), { code: "ENOTFOUND" });
    };
    const result = await probe("https://nope.test/", { ...base, resolver });
    expect(result.errorCode).toBe("DNS_NOT_FOUND");
  });

  it.each([
    ["ENODATA", "DNS_NOT_FOUND"],
    ["ETIMEOUT", "DNS_TIMEOUT"],
    ["ECONNREFUSED", "DNS_FAILED"],
    ["ESERVFAIL", "DNS_FAILED"],
  ])("maps resolver error %s to %s, never to a socket code", async (code, expected) => {
    const resolver: Resolver = async () => {
      throw Object.assign(new Error(`query ${code}`), { code });
    };
    const result = await probe("https://dns.test/", { ...base, resolver });
    expect(result.errorCode).toBe(expected);
  });

  it("times out slow resolvers", async () => {
    const resolver: Resolver = () => new Promise(() => {});
    const result = await probe("https://slow.test/", { ...base, resolver, timeoutMs: 100 });
    expect(result.errorCode).toBe("DNS_TIMEOUT");
  });

  it("blocks hostnames that resolve to private addresses", async () => {
    const resolver: Resolver = async () => [{ address: "10.0.0.5", family: 4 }];
    const result = await probe("https://evil.test/", { resolver });
    expect(result.errorCode).toBe("BLOCKED_ADDRESS");
  });

  it("blocks answers that mix public and private addresses", async () => {
    const resolver: Resolver = async () => [
      { address: "93.184.215.14", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
    const result = await probe("https://mixed.test/", { resolver });
    expect(result.errorCode).toBe("BLOCKED_ADDRESS");
  });

  it("resolves once per hop and connects to the address it validated (no rebinding)", async () => {
    const port = await serve((_req, res) => res.end("ok"));
    let calls = 0;
    const resolver: Resolver = async () => {
      calls++;
      // A rebinding attacker answers "safe" first and "internal" afterwards.
      return calls === 1 ? [{ address: "127.0.0.1", family: 4 }] : [{ address: "10.0.0.1", family: 4 }];
    };
    const result = await probe(`http://rebind.test:${port}/`, { ...base, resolver });
    expect(result.ok).toBe(true);
    expect(result.resolvedIp).toBe("127.0.0.1");
    expect(calls).toBe(1);
  });

  it("still blocks internal names whose address is outside the allowed ranges", async () => {
    const resolver: Resolver = async () => [{ address: "10.0.0.7", family: 4 }];
    const result = await probe("http://flaky:8080/", { resolver, guard: { allowPrivateCidrs: ["172.30.0.10/32"] } });
    expect(result.errorCode).toBe("BLOCKED_ADDRESS");
  });

  it("rejects disallowed URLs before any network activity", async () => {
    let called = false;
    const resolver: Resolver = async () => {
      called = true;
      return [];
    };
    const result = await probe("http://localhost:3000/", { resolver });
    expect(result.errorCode).toBe("BLOCKED_URL");
    expect(called).toBe(false);
  });
});

const hasOpenssl = (() => {
  try {
    execFileSync("openssl", ["version"]);
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasOpenssl)("probe over HTTPS", () => {
  let dir: string;
  let cert: string;
  let port: number;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "sitepulse-tls-"));
    execFileSync(
      "openssl",
      [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
        "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"),
        "-subj", "/CN=secure.test", "-addext", "subjectAltName=DNS:secure.test",
      ],
      { stdio: "ignore" },
    );
    cert = readFileSync(join(dir, "cert.pem"), "utf8");
    port = await listen(
      https.createServer({ key: readFileSync(join(dir, "key.pem")), cert }, (_req, res) => res.end("secure")),
    );
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("measures the TLS handshake and reads the certificate expiry", async () => {
    const result = await probe(`https://secure.test:${port}/`, { ...base, ca: cert });
    expect(result.ok).toBe(true);
    expect(result.timings.tls).not.toBeNull();
    expect(result.tlsValidTo).toBeInstanceOf(Date);
    expect(result.tlsValidTo!.getTime()).toBeGreaterThan(Date.now());
  });

  it("flags self-signed certificates as TLS_UNTRUSTED", async () => {
    const result = await probe(`https://secure.test:${port}/`, base);
    expect(result.errorCode).toBe("TLS_UNTRUSTED");
  });

  it("flags certificates for another hostname", async () => {
    const result = await probe(`https://wrong.test:${port}/`, { ...base, ca: cert });
    expect(result.errorCode).toBe("TLS_HOSTNAME_MISMATCH");
  });

  it("flags HTTPS against a plain HTTP port", async () => {
    const plainPort = await serve((_req, res) => res.end("plain"));
    const result = await probe(`https://secure.test:${plainPort}/`, base);
    expect(result.errorCode).toBe("TLS_HANDSHAKE_FAILED");
  });
});

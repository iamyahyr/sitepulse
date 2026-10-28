import { describe, expect, it } from "vitest";
import { checkUrl, isBlockedAddress, isValidCidr } from "./ssrf-guard";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "0.0.0.0",
    "10.0.0.1",
    "172.16.5.4",
    "192.168.1.1",
    "169.254.169.254",
    "169.254.1.1",
    "100.64.0.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "192.0.2.1",
    "::",
    "::1",
    "fe80::1",
    "fd00::1",
    "fd00:ec2::254",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "2002:a00::1",
    "2001::1",
    "2001:db8::1",
    "not-an-ip",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.215.14", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows public %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it("lets operators opt in to private ranges", () => {
    const options = { allowPrivateCidrs: ["192.168.1.0/24", "fd12::/16"] };
    expect(isBlockedAddress("192.168.1.20", options)).toBe(false);
    expect(isBlockedAddress("::ffff:192.168.1.20", options)).toBe(false);
    expect(isBlockedAddress("fd12::5", options)).toBe(false);
    expect(isBlockedAddress("192.168.2.20", options)).toBe(true);
    expect(isBlockedAddress("10.0.0.1", options)).toBe(true);
  });

  it("never allows cloud metadata, even when its range is allowed", () => {
    expect(isBlockedAddress("169.254.169.254", { allowPrivateCidrs: ["169.254.0.0/16"] })).toBe(true);
  });
});

describe("checkUrl", () => {
  it("accepts ordinary public URLs", () => {
    const result = checkUrl("https://example.com/health?x=1");
    expect(result.ok).toBe(true);
  });

  it("leaves internal names to the DNS check once private ranges are allowed", () => {
    const options = { allowPrivateCidrs: ["172.30.0.10/32"] };
    expect(checkUrl("http://flaky:8080/shop", options).ok).toBe(true);
    expect(checkUrl("http://nas.local/", options).ok).toBe(true);
    // Literal IPs are still judged immediately against the allowlist.
    expect(checkUrl("http://172.30.0.10:8080/", options).ok).toBe(true);
    expect(checkUrl("http://172.30.0.11:8080/", options)).toEqual({ ok: false, reason: "BLOCKED_ADDRESS" });
    expect(checkUrl("http://169.254.169.254/", options)).toEqual({ ok: false, reason: "BLOCKED_ADDRESS" });
  });

  it.each([
    ["not a url", "INVALID_URL"],
    ["ftp://example.com", "UNSUPPORTED_PROTOCOL"],
    ["file:///etc/passwd", "UNSUPPORTED_PROTOCOL"],
    ["gopher://example.com", "UNSUPPORTED_PROTOCOL"],
    ["https://user:pass@example.com", "CREDENTIALS_IN_URL"],
    ["http://localhost:3000", "BLOCKED_HOSTNAME"],
    ["http://api.localhost", "BLOCKED_HOSTNAME"],
    ["http://printer.local", "BLOCKED_HOSTNAME"],
    ["http://metadata.google.internal", "BLOCKED_HOSTNAME"],
    ["http://intranet", "BLOCKED_HOSTNAME"],
    ["http://127.0.0.1", "BLOCKED_ADDRESS"],
    ["http://2130706433/", "BLOCKED_ADDRESS"],
    ["http://0x7f.1/", "BLOCKED_ADDRESS"],
    ["http://017700000001/", "BLOCKED_ADDRESS"],
    ["http://[::1]:8080/", "BLOCKED_ADDRESS"],
    ["http://[::ffff:127.0.0.1]/", "BLOCKED_ADDRESS"],
    ["http://169.254.169.254/latest/meta-data/", "BLOCKED_ADDRESS"],
  ])("rejects %s with %s", (url, reason) => {
    expect(checkUrl(url)).toEqual({ ok: false, reason });
  });
});

describe("isValidCidr", () => {
  it.each(["192.168.1.0/24", " 10.0.0.0/8 ", "172.30.0.10/32", "fc00::/7"])("accepts %s", (cidr) => {
    expect(isValidCidr(cidr)).toBe(true);
  });

  it.each(["192.168.1.0", "192.168.1.0/33", "nas.local/24", ""])("rejects %s", (cidr) => {
    expect(isValidCidr(cidr)).toBe(false);
  });
});

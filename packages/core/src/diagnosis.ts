/**
 * "Anatomy of an outage": every failed check carries one of these codes, and
 * each code maps to the layer that broke plus a plain-language explanation and
 * a hint about what to look at first.
 */

export const ERROR_CODES = [
  "BLOCKED_URL",
  "BLOCKED_ADDRESS",
  "DNS_NOT_FOUND",
  "DNS_TIMEOUT",
  "DNS_FAILED",
  "TCP_REFUSED",
  "TCP_TIMEOUT",
  "TCP_RESET",
  "NETWORK_UNREACHABLE",
  "TLS_TIMEOUT",
  "TLS_CERT_EXPIRED",
  "TLS_CERT_NOT_YET_VALID",
  "TLS_HOSTNAME_MISMATCH",
  "TLS_UNTRUSTED",
  "TLS_HANDSHAKE_FAILED",
  "TTFB_TIMEOUT",
  "BODY_TIMEOUT",
  "TOO_MANY_REDIRECTS",
  "INVALID_REDIRECT",
  "HTTP_4XX",
  "HTTP_5XX",
  "HTTP_UNEXPECTED_STATUS",
  "UNKNOWN",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type Layer = "config" | "dns" | "tcp" | "tls" | "http";

export type Diagnosis = {
  layer: Layer;
  title: string;
  hint: string;
};

const CATALOG: Record<ErrorCode, Diagnosis> = {
  BLOCKED_URL: {
    layer: "config",
    title: "URL not allowed",
    hint: "Only public http(s) URLs without embedded credentials can be monitored.",
  },
  BLOCKED_ADDRESS: {
    layer: "config",
    title: "Resolves to a private or reserved address",
    hint: "The hostname points to an internal network. Allow the range with ALLOW_PRIVATE_CIDRS if this is intentional.",
  },
  DNS_NOT_FOUND: {
    layer: "dns",
    title: "Domain does not resolve",
    hint: "Check the A/AAAA records and that the domain has not expired.",
  },
  DNS_TIMEOUT: {
    layer: "dns",
    title: "DNS lookup timed out",
    hint: "The authoritative nameservers are slow or unreachable.",
  },
  DNS_FAILED: {
    layer: "dns",
    title: "DNS lookup failed",
    hint: "The resolver returned an error. Check the nameserver configuration.",
  },
  TCP_REFUSED: {
    layer: "tcp",
    title: "Connection refused",
    hint: "The host is up but nothing is listening on that port. Is the web server or proxy running?",
  },
  TCP_TIMEOUT: {
    layer: "tcp",
    title: "Could not connect in time",
    hint: "The server is down, overloaded, or a firewall is dropping traffic.",
  },
  TCP_RESET: {
    layer: "tcp",
    title: "Connection reset",
    hint: "The server or a proxy closed the connection abruptly. Look for crashes or restarts.",
  },
  NETWORK_UNREACHABLE: {
    layer: "tcp",
    title: "Network unreachable",
    hint: "No route to the host. This may be a problem on the monitor's side.",
  },
  TLS_TIMEOUT: {
    layer: "tls",
    title: "TLS handshake timed out",
    hint: "TCP connects but the HTTPS negotiation never finishes. Check the proxy's TLS settings.",
  },
  TLS_CERT_EXPIRED: {
    layer: "tls",
    title: "Certificate expired",
    hint: "Renew the certificate (is the Let's Encrypt/certbot renewal job running?).",
  },
  TLS_CERT_NOT_YET_VALID: {
    layer: "tls",
    title: "Certificate not yet valid",
    hint: "The certificate's start date is in the future. Check the server clock.",
  },
  TLS_HOSTNAME_MISMATCH: {
    layer: "tls",
    title: "Certificate does not match the domain",
    hint: "The server presented a certificate for another hostname. Check the vhost / SNI configuration.",
  },
  TLS_UNTRUSTED: {
    layer: "tls",
    title: "Untrusted certificate",
    hint: "Self-signed or incomplete chain. Make sure the intermediate certificates are served.",
  },
  TLS_HANDSHAKE_FAILED: {
    layer: "tls",
    title: "TLS handshake failed",
    hint: "Protocol or cipher mismatch, or the port is not serving HTTPS.",
  },
  TTFB_TIMEOUT: {
    layer: "http",
    title: "Server accepted the connection but never answered",
    hint: "The app is hanging: look at slow queries, exhausted workers or deadlocks.",
  },
  BODY_TIMEOUT: {
    layer: "http",
    title: "Response started but did not finish",
    hint: "The server began sending and stalled mid-response.",
  },
  TOO_MANY_REDIRECTS: {
    layer: "http",
    title: "Too many redirects",
    hint: "Likely a redirect loop (e.g. http↔https or www↔apex).",
  },
  INVALID_REDIRECT: {
    layer: "http",
    title: "Redirect to a disallowed location",
    hint: "The site redirects to a non-http(s) URL or to a private address.",
  },
  HTTP_4XX: {
    layer: "http",
    title: "Client error status",
    hint: "The server is reachable but answers with a 4xx. The page may have moved or require auth.",
  },
  HTTP_5XX: {
    layer: "http",
    title: "Server error status",
    hint: "The server is reachable but the application is failing. 502/504 usually means the proxy is alive and the backend is not.",
  },
  HTTP_UNEXPECTED_STATUS: {
    layer: "http",
    title: "Unexpected status code",
    hint: "The response status is outside the expected range configured for this site.",
  },
  UNKNOWN: {
    layer: "http",
    title: "Unknown error",
    hint: "See the raw error message for details.",
  },
};

export function diagnose(code: ErrorCode, status?: number | null): Diagnosis {
  const base = CATALOG[code];
  if (code === "HTTP_5XX" && (status === 502 || status === 504)) {
    return {
      ...base,
      title: status === 502 ? "Bad gateway: proxy up, backend down" : "Gateway timeout: backend too slow",
    };
  }
  return base;
}

export function statusErrorCode(status: number): ErrorCode {
  if (status >= 500) return "HTTP_5XX";
  if (status >= 400) return "HTTP_4XX";
  return "HTTP_UNEXPECTED_STATUS";
}

/** Maps Node socket/TLS/DNS error codes to our taxonomy. */
export function classifyNodeError(err: unknown): ErrorCode {
  const code = (err as { code?: string } | null)?.code ?? "";
  switch (code) {
    case "ENOTFOUND":
    case "ENODATA":
      return "DNS_NOT_FOUND";
    case "EAI_AGAIN":
    case "ESERVFAIL":
      return "DNS_FAILED";
    case "ECONNREFUSED":
      return "TCP_REFUSED";
    case "ECONNRESET":
    case "EPIPE":
      return "TCP_RESET";
    case "ETIMEDOUT":
      return "TCP_TIMEOUT";
    case "ENETUNREACH":
    case "EHOSTUNREACH":
      return "NETWORK_UNREACHABLE";
    case "CERT_HAS_EXPIRED":
      return "TLS_CERT_EXPIRED";
    case "CERT_NOT_YET_VALID":
      return "TLS_CERT_NOT_YET_VALID";
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "TLS_HOSTNAME_MISMATCH";
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
    case "SELF_SIGNED_CERT_IN_CHAIN":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
    case "UNABLE_TO_GET_ISSUER_CERT_LOCALLY":
      return "TLS_UNTRUSTED";
    default:
      if (code.startsWith("ERR_SSL") || code.startsWith("ERR_TLS")) return "TLS_HANDSHAKE_FAILED";
      return "UNKNOWN";
  }
}

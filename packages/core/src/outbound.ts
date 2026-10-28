import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { resolveTarget, systemResolver, type Resolver } from "./probe";
import { checkUrl, type GuardOptions } from "./ssrf-guard";

/**
 * POST to a user-supplied URL (alert webhooks) with the same SSRF defences as
 * the prober: URL and resolved addresses are validated, the socket is pinned
 * to the validated IP, redirects are never followed, the response body is
 * discarded after a few KB.
 */

export type PostOptions = {
  guard?: GuardOptions;
  resolver?: Resolver;
  timeoutMs?: number;
  /** Extra trusted CA, only meant for tests. */
  ca?: string | Buffer;
};

export type PostResult =
  | { ok: true; status: number }
  | { ok: false; status: number | null; retryable: boolean; error: string; retryAfterSec?: number };

const MAX_RESPONSE_BYTES = 64 * 1024;

function retryAfterSeconds(header: string | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.round((at - Date.now()) / 1000));
}

export async function safePost(
  rawUrl: string,
  body: string,
  headers: Record<string, string>,
  options: PostOptions = {},
): Promise<PostResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const guard = options.guard ?? {};

  const check = checkUrl(rawUrl, guard);
  if (!check.ok) return { ok: false, status: null, retryable: false, error: `URL not allowed (${check.reason})` };
  const url = check.url;

  // One budget for DNS and the request together, like the prober.
  const deadline = performance.now() + timeoutMs;
  const resolution = await resolveTarget(url, options.resolver ?? systemResolver, guard, timeoutMs);
  if (!resolution.ok) {
    return { ok: false, status: null, retryable: resolution.code !== "BLOCKED_ADDRESS", error: resolution.message };
  }
  const target = resolution.target;
  const remainingMs = Math.round(deadline - performance.now());
  if (remainingMs <= 0) return { ok: false, status: null, retryable: true, error: `Timed out after ${timeoutMs} ms` };

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: PostResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      resolve(result);
    };

    const lookup: LookupFunction = (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) callback(null, [target]);
      else callback(null, target.address, target.family);
    };

    const req = (url.protocol === "https:" ? https : http).request(url, {
      method: "POST",
      agent: false,
      lookup,
      ca: options.ca,
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        "user-agent": "SitePulse-Alerts/0.1",
        ...headers,
      },
    });

    const timer = setTimeout(
      () => finish({ ok: false, status: null, retryable: true, error: `Timed out after ${timeoutMs} ms` }),
      remainingMs,
    );

    req.on("response", (res) => {
      const status = res.statusCode ?? 0;
      let read = 0;
      res.on("data", (chunk: Buffer) => {
        read += chunk.length;
        if (read > MAX_RESPONSE_BYTES) res.destroy();
      });
      const done = () => {
        if (status >= 200 && status < 300) return finish({ ok: true, status });
        if (status >= 300 && status < 400) {
          return finish({ ok: false, status, retryable: false, error: `HTTP ${status}: redirects are not followed` });
        }
        const retryable = status === 429 || status === 408 || status >= 500;
        finish({
          ok: false,
          status,
          retryable,
          error: `HTTP ${status}`,
          retryAfterSec: retryAfterSeconds(res.headers["retry-after"] as string | undefined),
        });
      };
      res.on("end", done);
      res.on("close", done);
      res.on("error", done);
    });

    req.on("error", (err) => finish({ ok: false, status: null, retryable: true, error: err.message }));
    req.end(body);
  });
}

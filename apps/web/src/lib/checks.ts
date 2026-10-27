import { diagnose, type ErrorCode } from "@sitepulse/core";
import type { checks } from "@sitepulse/db";

/** Milliseconds per phase; null when the phase never happened (no DNS for an IP, no TLS over http, failed earlier). */
export type Phases = { dns: number | null; connect: number | null; tls: number | null; ttfb: number | null; download: number | null };

type CheckRow = typeof checks.$inferSelect;

export function checkPhases(check: CheckRow): Phases {
  return {
    dns: check.dnsMs,
    connect: check.connectMs,
    tls: check.tlsMs,
    ttfb: check.ttfbMs,
    download: check.downloadMs,
  };
}

/** Stacked charts need numbers: a phase that did not happen contributes nothing. */
export function chartPhases(check: CheckRow) {
  return {
    dns: check.dnsMs ?? 0,
    connect: check.connectMs ?? 0,
    tls: check.tlsMs ?? 0,
    ttfb: check.ttfbMs ?? 0,
    download: check.downloadMs ?? 0,
  };
}

/** The waterfall row where a request broke, if the failure happened mid-flight. */
export function brokenPhase(code: string | null): keyof Phases | undefined {
  if (!code) return undefined;
  if (code === "TTFB_TIMEOUT") return "ttfb";
  if (code === "BODY_TIMEOUT") return "download";
  const layer = diagnose(code as ErrorCode).layer;
  if (layer === "dns") return "dns";
  if (layer === "tcp") return "connect";
  if (layer === "tls") return "tls";
  return undefined;
}

export function intervalLabel(sec: number): string {
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${sec / 60} min`;
  return `${sec / 3600} h`;
}

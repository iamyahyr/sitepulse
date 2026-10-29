"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import type { LiveScope } from "@/server/dal/live";

const POLL_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;

type Status = "live" | "paused" | "offline" | "signedOut";

const LABELS: Record<Status, string> = { live: "Live", paused: "Paused", offline: "Offline", signedOut: "Signed out" };

const TITLES: Record<Status, string> = {
  live: "This page updates on its own when new checks land",
  paused: "Updates paused while this tab is in the background",
  offline: "Cannot reach SitePulse, retrying",
  signedOut: "Your session ended. Reload the page to sign in again.",
};

/**
 * Keeps a server-rendered page current: polls the cheap `/api/live`
 * fingerprint while the tab is visible and re-renders the page only when it
 * changes. `since` is the fingerprint the page was rendered with, so a check
 * landing between render and hydration is not missed; `scope` must match the
 * one it was computed with.
 */
export function LiveRefresh({ since, scope }: { since: string; scope?: LiveScope }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("live");
  const seen = useRef(since);
  const url = scope ? `/api/live?${new URLSearchParams(scope)}` : "/api/live";

  // Each refresh re-renders the page with a newer fingerprint.
  useEffect(() => {
    seen.current = since;
  }, [since]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = POLL_MS;
    let inFlight = false;
    let stopped = false;
    const controller = new AbortController();

    async function poll() {
      clearTimeout(timer);
      if (stopped || inFlight) return;
      if (document.visibilityState !== "visible") {
        setStatus("paused");
        return;
      }
      inFlight = true;
      try {
        // Signed out: the proxy redirects to /login, which must not be followed.
        const res = await fetch(url, { cache: "no-store", redirect: "manual", signal: controller.signal });
        if (res.status === 401 || res.type === "opaqueredirect") {
          stopped = true;
          setStatus("signedOut");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { v } = (await res.json()) as { v: string };
        if (v !== seen.current) {
          seen.current = v;
          startTransition(() => router.refresh());
        }
        delay = POLL_MS;
        setStatus("live");
      } catch {
        if (controller.signal.aborted) return;
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
        setStatus("offline");
      } finally {
        inFlight = false;
      }
      if (!stopped && document.visibilityState === "visible") timer = setTimeout(poll, delay);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        void poll();
      } else {
        clearTimeout(timer);
        setStatus("paused");
      }
    }

    timer = setTimeout(poll, POLL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router, url]);

  const live = status === "live";
  return (
    <span className="text-muted inline-flex items-center gap-1.5 text-xs" title={TITLES[status]}>
      <span className="relative inline-flex size-2 shrink-0">
        {live && <span className="bg-up absolute inset-0 animate-ping rounded-full opacity-60" />}
        <span className={`${live ? "bg-up" : "bg-unknown"} relative inline-flex size-2 rounded-full`} />
      </span>
      {LABELS[status]}
    </span>
  );
}

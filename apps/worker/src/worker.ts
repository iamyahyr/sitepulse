import { utimes, writeFile } from "node:fs/promises";
import {
  isNetworkLayerFailure,
  isSuppressed,
  probe,
  type ConnectivityMonitor,
  type GuardOptions,
  type ProbeOptions,
} from "@sitepulse/core";
import { sql, workerHeartbeats, type Database } from "@sitepulse/db";
import { dispatchOnce, type DispatcherOptions } from "./dispatcher";
import { log } from "./log";
import { runMaintenance, type MaintenanceOptions } from "./maintenance";
import { recordResult } from "./record";
import { claimDueSites, deferSite, type ClaimedSite } from "./scheduler";

export const VERSION = "0.1.0";

export type WorkerOptions = {
  workerId: string;
  concurrency: number;
  pollMs: number;
  guard: GuardOptions;
  heartbeatUrl?: string;
  /** Touched after every healthy heartbeat, for container health checks. */
  healthFile?: string;
  /** Null disables rollups, degradation detection and retention in this worker. */
  maintenance: (MaintenanceOptions & { intervalMs: number }) | null;
  /** Null disables alert delivery from this worker. */
  alerts: DispatcherOptions | null;
  /** Null disables the self-connectivity guard. */
  connectivity: ConnectivityMonitor | null;
  /** Overrides for tests (resolver, CA…). */
  probeOptions?: Partial<ProbeOptions>;
};

const HEARTBEAT_EVERY_MS = 15_000;
const EXTERNAL_PING_EVERY_MS = 60_000;
/** How long to wait before retrying a site whose check was inconclusive because we were offline. */
export const OFFLINE_RETRY_MS = 60_000;

/**
 * Polls for due sites, probes them with bounded concurrency and records the
 * results. Stateless apart from in-flight probes: everything durable lives in
 * Postgres, so any number of workers can run side by side.
 */
export class Worker {
  private inFlight = new Set<Promise<void>>();
  private timers: NodeJS.Timeout[] = [];
  private stopped = true;
  private checksSinceHeartbeat = 0;
  private lastTickOk = false;
  private loggedOfflineReason: string | null = null;
  private dispatching: Promise<unknown> | null = null;
  private maintaining: Promise<unknown> | null = null;

  constructor(
    private readonly db: Database,
    private readonly options: WorkerOptions,
  ) {}

  start() {
    this.stopped = false;
    this.scheduleTick(0);
    this.scheduleDispatch(0);
    // Give the first checks a head start, then run on a fixed cadence.
    this.scheduleMaintenance(30_000);
    // Know our own connectivity from the start, so the dashboard can warn
    // right away instead of after the first failing site.
    void this.options.connectivity
      ?.status()
      .then(() => this.logConnectivityChange())
      .finally(() => void this.heartbeat());
    if (!this.options.connectivity) void this.heartbeat();
    this.timers.push(setInterval(() => void this.heartbeat(), HEARTBEAT_EVERY_MS));
    if (this.options.heartbeatUrl) {
      this.timers.push(setInterval(() => void this.pingExternal(), EXTERNAL_PING_EVERY_MS));
    }
    log("info", "worker started", { workerId: this.options.workerId, concurrency: this.options.concurrency });
  }

  /** Stops claiming new work and waits for in-flight probes to finish recording. */
  async stop() {
    this.stopped = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    await Promise.allSettled([...this.inFlight, this.dispatching, this.maintaining]);
    await this.heartbeat();
    log("info", "worker stopped", { workerId: this.options.workerId });
  }

  /** One polling round: claim as many due sites as there are free slots and start probing them. */
  async tick(): Promise<number> {
    const free = this.options.concurrency - this.inFlight.size;
    const claimed = await claimDueSites(this.db, free);
    for (const site of claimed) {
      const task = this.checkSite(site).finally(() => this.inFlight.delete(task));
      this.inFlight.add(task);
    }
    return claimed.length;
  }

  /** Waits until every probe started so far has been recorded. */
  async drain() {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
  }

  private scheduleTick(delay: number) {
    if (this.stopped) return;
    const timer = setTimeout(async () => {
      this.timers = this.timers.filter((t) => t !== timer);
      try {
        await this.tick();
        this.lastTickOk = true;
      } catch (err) {
        this.lastTickOk = false;
        log("error", "tick failed", { error: String(err) });
      }
      this.scheduleTick(this.options.pollMs);
    }, delay);
    this.timers.push(timer);
  }

  /** Alert delivery runs on its own loop so a slow webhook never delays checks. */
  private scheduleDispatch(delay: number) {
    const alerts = this.options.alerts;
    if (this.stopped || !alerts) return;
    const timer = setTimeout(async () => {
      this.timers = this.timers.filter((t) => t !== timer);
      try {
        this.dispatching = dispatchOnce(this.db, alerts);
        // Keep draining while there is a backlog.
        const claimed = (await this.dispatching) as number;
        this.dispatching = null;
        this.scheduleDispatch(claimed > 0 ? 0 : this.options.pollMs);
      } catch (err) {
        this.dispatching = null;
        log("error", "alert dispatch failed", { error: String(err) });
        this.scheduleDispatch(this.options.pollMs);
      }
    }, delay);
    this.timers.push(timer);
  }

  private scheduleMaintenance(delay: number) {
    const maintenance = this.options.maintenance;
    if (this.stopped || !maintenance) return;
    const timer = setTimeout(async () => {
      this.timers = this.timers.filter((t) => t !== timer);
      try {
        this.maintaining = runMaintenance(this.db, maintenance);
        await this.maintaining;
      } catch (err) {
        log("error", "maintenance failed", { error: String(err) });
      } finally {
        this.maintaining = null;
      }
      this.scheduleMaintenance(maintenance.intervalMs);
    }, delay);
    this.timers.push(timer);
  }

  private async checkSite(site: ClaimedSite) {
    const checkedAt = new Date();
    try {
      const result = await probe(site.url, {
        timeoutMs: site.timeoutMs,
        expectedStatus: site.expectedStatus,
        guard: this.options.guard,
        ...this.options.probeOptions,
      });
      const { connectivity } = this.options;
      connectivity?.noteProbe(result);

      // A network-level failure may be ours, not the site's: if the canaries
      // say this server is offline, the result says nothing about the site.
      if (connectivity && !result.ok && isNetworkLayerFailure(result.errorCode)) {
        const status = await connectivity.status();
        this.logConnectivityChange();
        if (isSuppressed(result.errorCode, status)) {
          await deferSite(this.db, site, new Date(Date.now() + OFFLINE_RETRY_MS));
          log("info", "check deferred: monitor offline", { siteId: site.id, errorCode: result.errorCode });
          return;
        }
      }
      this.logConnectivityChange();

      const outcome = await recordResult(this.db, site, result, checkedAt);
      this.checksSinceHeartbeat++;

      if (!outcome.recorded) {
        log("info", "result discarded", { siteId: site.id, reason: outcome.reason });
        return;
      }
      for (const event of outcome.events) {
        log(event.type === "opened" ? "warn" : "info", `incident ${event.type}`, { siteId: site.id, url: site.url, event });
      }
    } catch (err) {
      // The claim lease expires on its own, so the site is retried later.
      log("error", "check failed", { siteId: site.id, error: String(err) });
    }
  }

  private logConnectivityChange() {
    const state = this.options.connectivity?.state;
    const reason = state?.reason ?? null;
    if (reason === this.loggedOfflineReason) return;
    this.loggedOfflineReason = reason;
    if (reason) log("warn", "monitor offline: pausing verdicts on network failures", { reason, since: state?.offlineSince });
    else log("info", "monitor connectivity restored");
  }

  async heartbeat() {
    const { connectivity } = this.options;
    // While offline, re-measure on every heartbeat: recovery must not depend
    // on some site failing or answering (there may be no active sites at all).
    if (connectivity?.state.offlineSince) {
      await connectivity.status();
      this.logConnectivityChange();
    }
    const checks = this.checksSinceHeartbeat;
    this.checksSinceHeartbeat = 0;
    const offline = connectivity?.state ?? { offlineSince: null, reason: null };
    const fields = {
      lastSeenAt: new Date(),
      version: VERSION,
      offlineSince: offline.offlineSince,
      offlineReason: offline.reason,
    };
    try {
      await this.db
        .insert(workerHeartbeats)
        .values({ workerId: this.options.workerId, checksRun: checks, ...fields })
        .onConflictDoUpdate({
          target: workerHeartbeats.workerId,
          set: { ...fields, checksRun: sql`${workerHeartbeats.checksRun} + ${checks}` },
        });
      if (this.options.healthFile && this.lastTickOk) await touch(this.options.healthFile);
    } catch (err) {
      this.checksSinceHeartbeat += checks;
      log("error", "heartbeat failed", { error: String(err) });
    }
  }

  /**
   * Only pings while the last poll reached the database, so the external
   * monitor fires when the worker is dead *or* cut off from Postgres.
   */
  private async pingExternal() {
    if (!this.lastTickOk || !this.options.heartbeatUrl) return;
    try {
      await fetch(this.options.heartbeatUrl, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      log("warn", "external heartbeat ping failed", { error: String(err) });
    }
  }
}

async function touch(path: string) {
  const now = new Date();
  try {
    await utimes(path, now, now);
  } catch {
    await writeFile(path, "");
  }
}

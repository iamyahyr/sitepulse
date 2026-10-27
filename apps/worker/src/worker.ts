import { probe, type GuardOptions, type ProbeOptions } from "@sitepulse/core";
import { sql, workerHeartbeats, type Database } from "@sitepulse/db";
import { log } from "./log";
import { recordResult } from "./record";
import { claimDueSites, type ClaimedSite } from "./scheduler";

export const VERSION = "0.1.0";

export type WorkerOptions = {
  workerId: string;
  concurrency: number;
  pollMs: number;
  guard: GuardOptions;
  heartbeatUrl?: string;
  /** Overrides for tests (resolver, CA…). */
  probeOptions?: Partial<ProbeOptions>;
};

const HEARTBEAT_EVERY_MS = 15_000;
const EXTERNAL_PING_EVERY_MS = 60_000;

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

  constructor(
    private readonly db: Database,
    private readonly options: WorkerOptions,
  ) {}

  start() {
    this.stopped = false;
    this.scheduleTick(0);
    void this.heartbeat();
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
    await Promise.allSettled([...this.inFlight]);
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

  private async checkSite(site: ClaimedSite) {
    const checkedAt = new Date();
    try {
      const result = await probe(site.url, {
        timeoutMs: site.timeoutMs,
        expectedStatus: site.expectedStatus,
        guard: this.options.guard,
        ...this.options.probeOptions,
      });
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

  private async heartbeat() {
    const checks = this.checksSinceHeartbeat;
    this.checksSinceHeartbeat = 0;
    try {
      await this.db
        .insert(workerHeartbeats)
        .values({ workerId: this.options.workerId, lastSeenAt: new Date(), version: VERSION, checksRun: checks })
        .onConflictDoUpdate({
          target: workerHeartbeats.workerId,
          set: {
            lastSeenAt: new Date(),
            version: VERSION,
            checksRun: sql`${workerHeartbeats.checksRun} + ${checks}`,
          },
        });
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

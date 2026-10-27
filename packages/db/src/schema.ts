import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const tz = (name: string) => timestamp(name, { withTimezone: true });

const timestamps = {
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ─── Better Auth tables ─────────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  ...timestamps,
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: tz("expires_at").notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: tz("access_token_expires_at"),
    refreshTokenExpiresAt: tz("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: tz("expires_at").notNull(),
    ...timestamps,
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ─── Monitoring ─────────────────────────────────────────────────────────

export const siteState = pgEnum("site_state", ["unknown", "up", "suspect", "down"]);

export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    /** Free-text grouping for freelancers ("Client A"); drives status pages and reports later. */
    client: text("client"),
    intervalSec: integer("interval_sec").notNull().default(300),
    timeoutMs: integer("timeout_ms").notNull().default(10_000),
    expectedStatus: text("expected_status").notNull().default("200-399"),
    enabled: boolean("enabled").notNull().default(true),

    // Scheduler + state machine (see packages/core/src/incidents.ts)
    state: siteState("state").notNull().default("unknown"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    failingSince: tz("failing_since"),
    lastErrorCode: text("last_error_code"),
    nextCheckAt: tz("next_check_at").notNull().defaultNow(),
    lastCheckedAt: tz("last_checked_at"),
    tlsExpiresAt: tz("tls_expires_at"),
    ...timestamps,
  },
  (t) => [
    index("sites_owner_idx").on(t.ownerId),
    index("sites_due_idx").on(t.nextCheckAt).where(sql`${t.enabled}`),
  ],
);

export const checks = pgTable(
  "checks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    checkedAt: tz("checked_at").notNull(),
    success: boolean("success").notNull(),
    httpStatus: integer("http_status"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    dnsMs: integer("dns_ms"),
    connectMs: integer("connect_ms"),
    tlsMs: integer("tls_ms"),
    ttfbMs: integer("ttfb_ms"),
    downloadMs: integer("download_ms"),
    totalMs: integer("total_ms").notNull(),
    resolvedIp: text("resolved_ip"),
    redirectCount: integer("redirect_count").notNull().default(0),
  },
  (t) => [index("checks_site_time_idx").on(t.siteId, t.checkedAt.desc())],
);

/** Hourly aggregates so 7/30-day charts never scan raw checks. */
export const checkRollupsHourly = pgTable(
  "check_rollups_hourly",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    hour: tz("hour").notNull(),
    total: integer("total").notNull(),
    ok: integer("ok").notNull(),
    p50TotalMs: real("p50_total_ms"),
    p95TotalMs: real("p95_total_ms"),
    p50DnsMs: real("p50_dns_ms"),
    p50ConnectMs: real("p50_connect_ms"),
    p50TlsMs: real("p50_tls_ms"),
    p50TtfbMs: real("p50_ttfb_ms"),
    p50DownloadMs: real("p50_download_ms"),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.hour] })],
);

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    startedAt: tz("started_at").notNull(),
    resolvedAt: tz("resolved_at"),
    causeCode: text("cause_code").notNull(),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    failedChecks: integer("failed_checks").notNull().default(0),
  },
  (t) => [
    index("incidents_site_time_idx").on(t.siteId, t.startedAt.desc()),
    // At most one open incident per site, enforced by the database.
    uniqueIndex("incidents_one_open_per_site").on(t.siteId).where(sql`${t.resolvedAt} is null`),
  ],
);

/** Timeline entries. "closed" = ended because monitoring was paused or the URL changed, not a real recovery. */
export const incidentEvents = pgTable(
  "incident_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    at: tz("at").notNull(),
    type: text("type", { enum: ["opened", "cause_changed", "resolved", "closed"] }).notNull(),
    errorCode: text("error_code"),
  },
  (t) => [index("incident_events_incident_idx").on(t.incidentId, t.at)],
);

/**
 * Sustained slowdowns of one request phase (e.g. TTFB ×3 over its usual
 * median) while the site is still up: an early warning before an outage.
 */
export const siteDegradations = pgTable(
  "site_degradations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    phase: text("phase", { enum: ["dns", "connect", "tls", "ttfb", "download"] }).notNull(),
    startedAt: tz("started_at").notNull(),
    resolvedAt: tz("resolved_at"),
    baselineMs: real("baseline_ms").notNull(),
    /** Recent median when detected, then the worst seen while it lasted. */
    peakMs: real("peak_ms").notNull(),
  },
  (t) => [
    index("site_degradations_site_time_idx").on(t.siteId, t.startedAt.desc()),
    uniqueIndex("site_degradations_one_open_per_site").on(t.siteId).where(sql`${t.resolvedAt} is null`),
  ],
);

// ─── Alerting ───────────────────────────────────────────────────────────

export const alertChannelType = pgEnum("alert_channel_type", ["discord", "webhook"]);

export const alertChannels = pgTable("alert_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  type: alertChannelType("type").notNull(),
  name: text("name").notNull(),
  /** AES-256-GCM ciphertext of the channel config (webhook URL, HMAC secret). Never sent to the browser. */
  configEncrypted: text("config_encrypted").notNull(),
  ...timestamps,
});

export const siteAlertChannels = pgTable(
  "site_alert_channels",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => alertChannels.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.siteId, t.channelId] })],
);

export const notificationKind = pgEnum("notification_kind", ["down", "up", "degraded"]);
export const notificationStatus = pgEnum("notification_status", ["pending", "sent", "failed"]);

/**
 * Transactional outbox. A row is inserted in the same transaction that opens
 * or resolves an incident (or opens a degradation); the unique keys make
 * duplicate alerts impossible.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id").references(() => incidents.id, { onDelete: "cascade" }),
    degradationId: uuid("degradation_id").references(() => siteDegradations.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => alertChannels.id, { onDelete: "cascade" }),
    kind: notificationKind("kind").notNull(),
    status: notificationStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: tz("next_attempt_at").notNull().defaultNow(),
    sentAt: tz("sent_at"),
    lastError: text("last_error"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notifications_once").on(t.incidentId, t.channelId, t.kind),
    uniqueIndex("notifications_degradation_once").on(t.degradationId, t.channelId, t.kind),
    // Every alert is about exactly one incident or one degradation.
    check("notifications_one_subject", sql`(${t.incidentId} is null) <> (${t.degradationId} is null)`),
    index("notifications_pending_idx").on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`),
  ],
);

// ─── Worker liveness ────────────────────────────────────────────────────

export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  lastSeenAt: tz("last_seen_at").notNull(),
  version: text("version").notNull(),
  checksRun: bigint("checks_run", { mode: "number" }).notNull().default(0),
  /** Set while the worker itself cannot reach the internet; checks are paused meanwhile. */
  offlineSince: tz("offline_since"),
  offlineReason: text("offline_reason", { enum: ["network", "dns"] }),
});

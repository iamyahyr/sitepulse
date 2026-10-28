# SitePulse

Self-hosted, open-source uptime monitoring that tells you **where and why** a site is failing, not just that it is down.

> 🚧 Work in progress. See [docs/PLAN.md](docs/PLAN.md) for the roadmap (in Spanish).

- **Anatomy of an outage:** every check records DNS → TCP → TLS → TTFB → download timings, and every failure gets a plain-language diagnosis ("Bad gateway: proxy up, backend down").
- **Honest uptime:** time-weighted from confirmed incidents, never the ratio of successful checks.
- **SSRF-hardened prober:** DNS answers are validated and pinned per hop, so rebinding and redirects to internal networks are blocked.
- **No duplicate alerts:** incidents and notifications are written in one transaction (outbox pattern).

## Self-hosting

Requirements: a server with Docker and Docker Compose. Everything (Postgres, the worker and the web app) runs from `docker-compose.yml`.

```bash
git clone https://github.com/iamyahyr/sitepulse.git && cd sitepulse
cp .env.example .env
# Fill in POSTGRES_PASSWORD, BETTER_AUTH_SECRET and SITEPULSE_SECRET_KEY (openssl rand -hex 32 each)
# and set APP_URL to the address you will use, e.g. https://status.example.com
docker compose up -d --build
```

Open `APP_URL`, create the admin account on `/setup` (sign-up closes right after) and add your sites. The worker applies database migrations on start, and the web container only starts once the worker is healthy.

- **Updating:** `git pull && docker compose up -d --build`. Migrations run automatically.
- **Backups:** everything lives in the `postgres-data` volume, e.g. `docker compose exec postgres pg_dump -U sitepulse sitepulse > backup.sql`.
- **HTTPS:** put SitePulse behind your reverse proxy (Caddy, Traefik, Nginx, or Dokploy's built-in one) and set `APP_URL` to the public `https://` address.
- **Health checks:** the web container serves `GET /api/health` (checks the database); the worker is healthy while its heartbeat is fresh.
- **Watching the watcher:** a monitor cannot report its own death. Set `HEARTBEAT_URL` to a [healthchecks.io](https://healthchecks.io) (or similar) ping URL to get alerted if the worker stops.
- **Monitoring internal services:** private and loopback addresses are blocked by default (SSRF protection). Allow specific ranges with `ALLOW_PRIVATE_CIDRS=192.168.1.0/24`.
- **Dokploy:** create a *Compose* application pointing at this repository, add the variables from `.env.example` in its Environment tab, and attach your domain to the `web` service on port 3000.

## Public demo

A read-only instance anyone can open without an account. The demo sites are served by `apps/flaky`, a small service that fails on purpose on a fixed UTC schedule:

| Site | Scenario | What SitePulse shows |
| --- | --- | --- |
| Portfolio | Always healthy | Baseline |
| Sample Shop | 502 for 5 minutes every 4 hours | Incident, "Bad gateway: proxy up, backend down", alerts |
| Store API | Hangs for 7 minutes every 6 hours | Incident with a TTFB timeout in the waterfall |
| Blog | 5× slower for one hour every 4 hours | "Slower than usual: Server response (TTFB)" warning, no outage |

Checks run every minute, so incidents open and close while visitors watch. On first start the worker backfills a week of history generated from the same schedule and pushed through the real incident state machine, so the past and the live data agree.

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --build
```

In demo mode every visitor browses as a built-in account with no password or session, every write is refused on the server, and the SSRF allowlist opens exactly one private address: the flaky service (`172.30.0.10/32`). Run it on its own database.

For local development, `pnpm --filter @sitepulse/flaky dev` serves the scenarios on `:8080` and `pnpm db:seed you@example.com` adds the demo sites with their history to your account (run the worker with `ALLOW_PRIVATE_CIDRS=127.0.0.0/8`).

## Development

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d   # Postgres on 127.0.0.1:5442
cp apps/web/.env.example apps/web/.env.local     # then set BETTER_AUTH_SECRET
cp apps/worker/.env.example apps/worker/.env
pnpm db:migrate
pnpm dev                                         # web + worker; open /setup to create the admin account
pnpm db:seed you@example.com                     # optional: demo sites + 7 days of history
pnpm test                                        # set TEST_DATABASE_URL to also run the worker's Postgres tests
```

## How checks run

The worker (`apps/worker`) is a separate Node process, so checks keep running with no browser open:

1. Every 2 s it claims due sites with `SELECT … FOR UPDATE SKIP LOCKED` and leases them, so any number of worker replicas can share the table without double-checking a site.
2. Each site is probed outside the transaction (DNS → TCP → TLS → TTFB → download, SSRF-guarded).
3. The result, the site's health state, the incident timeline and the alert outbox are written in one transaction.
4. One failure marks a site *suspect* and rechecks it after a minute; a second consecutive failure opens an incident, backdated to the first failure. The first success resolves it.
5. A heartbeat row shows the worker's liveness on the dashboard, and `HEARTBEAT_URL` (e.g. healthchecks.io) can alert you if the worker itself dies.
6. **Self-connectivity guard.** If the monitor's own server loses its network or DNS, every site would look down at once. Before a network-level failure (DNS, TCP, TLS timeout…) counts against a site, the worker checks canaries (TCP to 1.1.1.1 / 8.8.8.8 / 9.9.9.9 and lookups of well-known names). If they fail too, the result is set aside and retried in a minute, and the dashboard shows that SitePulse itself is offline. Responses that prove the site answered (a 502, an expired certificate) are always recorded, and a real site answering recently overrides blocked canaries so a firewall cannot hide genuine outages.

```bash
pnpm --filter @sitepulse/worker dev
```

## History and early warnings

Every 5 minutes the worker runs maintenance:

- **Hourly rollups.** Raw checks are aggregated per site and hour (success count, p50/p95 total time, p50 of every phase). The 7- and 30-day charts read these, so they stay fast and outlive raw data.
- **Retention.** Raw checks are deleted after `CHECK_RETENTION_DAYS` (30), hourly rollups after `ROLLUP_RETENTION_DAYS` (400), in small batches. Incidents are never deleted, so uptime history is kept.
- **Degradation detection.** For each healthy site, the median of every phase over the last hour is compared with that site's own 7-day baseline. When a phase is at least 2.5× slower *and* 200 ms slower, SitePulse opens a "slower than usual" warning naming the phase (e.g. *Server response (TTFB) ×3.2: look at slow queries, CPU, cold caches*) and sends one alert. It closes when the phase drops back under 1.5× (hysteresis, so it does not flap). Both conditions are needed, so 5 ms → 20 ms never pages anyone.

## Alerts

One message when an incident opens, one when it resolves and one when a site starts degrading, through **Discord** or a **signed webhook** (Slack, n8n, ntfy, Zapier…). Alerts go through a transactional outbox: written in the same transaction that opens or resolves the incident, delivered by the worker with retries and exponential backoff, never duplicated per check. Channel settings are encrypted at rest with `SITEPULSE_SECRET_KEY` (same value in web and worker), and webhook URLs get the same SSRF protection as monitored sites.

Webhook requests carry `X-SitePulse-Event`, `X-SitePulse-Delivery` (stable across retries, use it to de-duplicate) and `X-SitePulse-Signature: t=<unix>,v1=<hex>`, the HMAC-SHA256 of `` `${t}.${rawBody}` `` with the channel's secret:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, rawBody, header, toleranceSec = 300) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((kv) => kv.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false; // replay
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

## License

[MIT](LICENSE)

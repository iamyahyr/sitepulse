# SitePulse

Self-hosted, open-source uptime monitoring that tells you **where and why** a site is failing, not just that it is down.

> 🚧 Work in progress. See [docs/PLAN.md](docs/PLAN.md) for the roadmap (in Spanish).

- **Anatomy of an outage:** every check records DNS → TCP → TLS → TTFB → download timings, and every failure gets a plain-language diagnosis ("Bad gateway: proxy up, backend down").
- **Honest uptime:** time-weighted from confirmed incidents, never the ratio of successful checks.
- **SSRF-hardened prober:** DNS answers are validated and pinned per hop, so rebinding and redirects to internal networks are blocked.
- **No duplicate alerts:** incidents and notifications are written in one transaction (outbox pattern).

## Development

```bash
pnpm install
docker compose -f docker-compose.dev.yml up -d   # Postgres on 127.0.0.1:5442
cp apps/web/.env.example apps/web/.env.local     # then set BETTER_AUTH_SECRET
cp apps/worker/.env.example apps/worker/.env
pnpm db:migrate
pnpm dev                                         # web + worker; open /setup to create the admin account
pnpm db:seed you@example.com                     # optional: 7 days of demo history
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

## Alerts

One message when an incident opens and one when it resolves, through **Discord** or a **signed webhook** (Slack, n8n, ntfy, Zapier…). Alerts go through a transactional outbox: written in the same transaction that opens or resolves the incident, delivered by the worker with retries and exponential backoff, never duplicated per check. Channel settings are encrypted at rest with `SITEPULSE_SECRET_KEY` (same value in web and worker), and webhook URLs get the same SSRF protection as monitored sites.

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

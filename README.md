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

```bash
pnpm --filter @sitepulse/worker dev
```

## License

[MIT](LICENSE)

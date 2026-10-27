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
pnpm db:migrate
pnpm dev
pnpm test
```

## License

[MIT](LICENSE)

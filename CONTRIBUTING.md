# Contributing

Thanks for wanting to help. Bug reports, ideas and pull requests are all welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the approach.
- Security problems go through private reporting, not issues: see [SECURITY.md](SECURITY.md).

## Setting up

Follow [Development](README.md#development) in the README. You need Node.js 24, pnpm 10 and Docker (for Postgres).

## Checks

Pull requests must pass what CI runs:

```bash
pnpm typecheck
pnpm lint
TEST_DATABASE_URL=postgres://sitepulse:sitepulse@localhost:5442/sitepulse_test pnpm test
pnpm build
```

Create the test database once with `docker compose -f docker-compose.dev.yml exec postgres createdb -U sitepulse sitepulse_test`. The Postgres tests wipe it on every run, so never point `TEST_DATABASE_URL` at real data.

## Guidelines

- **Logic lives in `packages/core`** as plain, tested functions; apps orchestrate it. New behaviour comes with tests.
- **Schema changes** go through Drizzle: edit `packages/db/src/schema.ts`, then `pnpm db:generate` and commit the migration.
- **Anything that makes requests to user-supplied URLs** must go through `checkUrl` / `resolveTarget` (see `packages/core/src/ssrf-guard.ts` and `probe.ts`).
- Match the style of the code around you; comments explain *why*, not *what*.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`…).

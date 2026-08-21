# Proposal: Testing Strategy — Mock Phase-Out and SQLite Environment Tiers

**Status**: Proposed
**Date**: 2026-08-20
**Source**: `portfoliost/docs/proposals/testing-strategy.md` (canonical copy)

> This is a cross-reference. The full proposal lives in the frontend repo at
> `portfoliost/docs/proposals/testing-strategy.md`.

## Summary

The project is migrating from mock backend to real backend endpoint by endpoint.
This proposal defines:

1. **Three-tier testing** — backend unit tests (`:memory:` SQLite), frontend unit tests (mocked API), E2E tests (real backend + seeded volatile SQLite)
2. **SQLite environment tiers** — volatile in docker compose, persistent in Kubernetes, in-memory for tests
3. **Seed system** — `seed/` directory with SQL files, run on container start if DB is empty
4. **Mock phase-out process** — per-endpoint migration flow, KrakenD route switching, eventual mock removal

## Key Files

- `src/db/index.ts` — `DATABASE_URL` env var for SQLite path switching
- `seed/seed.ts` — seed runner with empty-DB check
- `seed/*.sql` — idempotent seed fixtures
- `Dockerfile` — CMD includes `db:migrate && db:seed`
- `docker-compose.yml` (in frontend repo) — removes persistent volume, sets volatile `DATABASE_URL`

## Relevance to This Repo

This backend repo is directly affected by:
- Phase 1: Adding `DATABASE_URL` env var support to `src/db/index.ts`
- Phase 2+: Implementing endpoints, writing unit tests, adding seed files
- All E2E tests run against this backend via docker compose

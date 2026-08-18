# Proposal: Database Layer — Drizzle + SQLite (dev) / Postgres (prod)

**Status**: Proposed  
**Date**: 2026-08-18  

## Problem

The real backend (replacing mock endpoints) needs persistent storage for app-specific user data: language preference, UI preferences (chart timeframes, table column configs), custom benchmarks, custom timeframes, and onboarding status. Identity data (email, name) comes from PocketID/lldap via JWT claims and does not need storage.

Multi-user support must be present from the start — the backend is a shared service, not a single-user app. Each user's data is isolated by their JWT `sub` claim.

The mock backend currently serves this data from static JSON seed files with no persistence at all.

## Proposed Solution

The backend lives at `../portfoliost-backend/` (sibling to the `portfoliost` frontend repo).

Use **Drizzle ORM** with **SQLite** for local development and **Postgres** for cluster deployment. Drizzle provides:

- TypeScript-first schema definitions (the schema IS the contract)
- Plain SQL migration files (like Flyway)
- Seamless dialect switching — change the import and connection string
- Inferred TypeScript types for select/insert operations

### Migration Strategy: SQLite → Postgres

Drizzle supports both dialects with identical schema definitions. Switching requires:

1. Changing the driver import (`better-sqlite3` → `pg`)
2. Updating the connection string
3. No schema or migration changes — both use the same SQL (Drizzle generates dialect-compatible SQL)

### Schema Design

```ts
// src/db/schema.ts
import { sqliteTable, text } from "drizzle-orm/sqlite-core"

export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id").primaryKey(),  // from JWT claims (sub)
  language: text("language").default("en"),
  uiPreferences: text("ui_preferences", { mode: "json" }),
  customBenchmarks: text("custom_benchmarks", { mode: "json" }).default("[]"),
  customTimeframes: text("custom_timeframes", { mode: "json" }).default("[]"),
  onboardingStatus: text("onboarding_status", { mode: "json" })
    .default('{"completed":false}'),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})
```

Single table. Keyed by user ID from JWT (`sub` claim). Multi-user by design — each row belongs to one user, all queries filter by `userId`. JSON columns for structured data (SQLite stores JSON as text; Postgres has native JSONB — Drizzle handles both).

### Migration Workflow

```bash
# Generate migration from schema changes
npx drizzle-kit generate

# Apply to SQLite (local dev)
npx drizzle-kit migrate

# Apply to Postgres (cluster)
DATABASE_URL=postgresql://... npx drizzle-kit migrate
```

### Local Development

SQLite file lives at `data/portfoliost.db` (gitignored). Created automatically on first run. No server process, no Docker volume — just a file.

### Cluster Deployment

Postgres connection via `DATABASE_URL` env var. Migrations run as a Kubernetes init container or job before the backend starts.

## What Goes in the DB vs JWT

| Field | Source | Mutability |
|-------|--------|-----------|
| `id` (user ID) | JWT claim `sub` | Read-only |
| `email` | JWT claim | Read-only |
| `firstName`, `lastName` | JWT claim (from lldap) | Read-only |
| `language` | DB (`user_preferences.language`) | Read/write via API |
| `uiPreferences` | DB (JSON) | Read/write via API |
| `customBenchmarks` | DB (JSON) | Read/write via API |
| `customTimeframes` | DB (JSON) | Read/write via API |
| `onboardingStatus` | DB (JSON) | Read/write via API |
| `isDemoUser` | Hardcoded `false` | Read-only |
| `role` | Hardcoded `"user"` or JWT claim | Read-only |

### Profile Endpoint Behavior

`GET /api/users/profile` merges JWT claims + DB row:
```json
{
  "id": "<from JWT sub>",
  "email": "<from JWT>",
  "firstName": "<from JWT>",
  "lastName": "<from JWT>",
  "language": "<from DB>",
  "isDemoUser": false,
  "createdAt": "<from JWT or DB>"
}
```

`PATCH /api/users/profile` writes only to DB (language and other app-specific fields). Identity fields in the request body are ignored.

## Existing Mock Compatibility

The mock backend serves these endpoints from seed JSON files:

| Mock endpoint | Mock source | Real backend source |
|--------------|-------------|-------------------|
| `GET /api/users/profile` | `users_profile.json` (static) | JWT claims + DB |
| `PATCH /api/users/profile` | In-memory merge | DB only |
| `GET /api/users/preferences` | `users_preferences.json` (static) | DB |
| `PATCH /api/users/preferences` | In-memory merge | DB |
| `GET /api/users/preferences/custom-benchmarks` | `users_preferences_custom_benchmarks.json` | DB (JSON column) |
| `GET /api/users/preferences/custom-timeframes` | `users_preferences_custom_timeframes.json` | DB (JSON column) |
| `GET /api/users/onboarding/status` | `users_onboarding_status.json` | DB (JSON column) |

Response shapes must match exactly — the frontend already consumes these.

## Risks / Considerations

- **SQLite JSON limitations**: SQLite stores JSON as text; queries on JSON fields are less efficient than Postgres JSONB. Acceptable for homelab scale.
- **No ORM query builder for JSON**: Drizzle's SQLite dialect has limited JSON query support. For this use case (read/write entire JSON blobs), it's fine.
- **Multi-user from day one**: Schema is keyed by `userId`. All API endpoints extract the user ID from the JWT `sub` claim and scope queries accordingly. No shared state between users.
- **Auto-provisioning**: When a user authenticates for the first time, the backend upserts a `user_preferences` row with defaults. No separate registration step needed — PocketID/lldap handles user creation.
- **Postgres migration path**: Well-supported by Drizzle. The main risk is using SQLite-specific SQL in migrations — Drizzle's generator avoids this.

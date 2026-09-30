import { index, jsonb, pgSchema, pgTable, text } from "drizzle-orm/pg-core"

export const usersAuthSchema = pgSchema("users_auth")

export const userPreferences = usersAuthSchema.table("user_preferences", {
  userId: text("user_id").primaryKey(),
  language: text("language").default("en"),
  uiPreferences: jsonb("ui_preferences"),
  customBenchmarks: jsonb("custom_benchmarks").default([]),
  customTimeframes: jsonb("custom_timeframes").default([]),
  onboardingStatus: jsonb("onboarding_status").default({ completed: false }),
  onboardingDraft: jsonb("onboarding_draft").default({ draft: null }),
  recentSearches: jsonb("recent_searches").default([]),
  lastLogin: text("last_login"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

/**
 * A live OIDC session: PocketID's 30-day refresh token, held hashed, keyed by
 * the `jti` of the id_token the browser is currently holding (§77.2).
 *
 * The refresh token never leaves this process. Every refresh re-keys the row to
 * the newly issued id_token's `jti` and stores its new hash, because
 * PocketID consumes the old refresh token server-side — a replay of the
 * previous `jti` must find nothing.
 *
 * `userId` is a plain column, not a foreign key to `user_preferences`: those
 * rows are auto-provisioned at login and can be deleted by
 * DELETE /api/users/clear-data, and a refresh session must not be destroyed
 * (nor block) just because a user cleared their preferences. Indexed so
 * clearing an account can still sweep its sessions in one statement.
 */
export const refreshSessions = usersAuthSchema.table(
  "refresh_sessions",
  {
    idTokenJti: text("id_token_jti").primaryKey(),
    userId: text("user_id").notNull(),
    /** sha256 hex of the PocketID refresh token. Never the token itself. */
    refreshTokenHash: text("refresh_token_hash").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("refresh_sessions_user_id_idx").on(t.userId)]
)

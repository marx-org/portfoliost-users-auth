import { jsonb, pgSchema, pgTable, text } from "drizzle-orm/pg-core"

export const usersAuthSchema = pgSchema("users_auth")

export const userPreferences = usersAuthSchema.table("user_preferences", {
  userId: text("user_id").primaryKey(),
  language: text("language").default("en"),
  uiPreferences: jsonb("ui_preferences"),
  customBenchmarks: jsonb("custom_benchmarks").default([]),
  customTimeframes: jsonb("custom_timeframes").default([]),
  onboardingStatus: jsonb("onboarding_status").default({ completed: false }),
  onboardingDraft: jsonb("onboarding_draft").default({ draft: null }),
  // Identity snapshot from the OIDC id_token, refreshed on every login
  // (admin-module D48b amendment: persisted here instead of per-user
  // OIDC UserInfo calls — client-credentials tokens have no user subject).
  email: text("email"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  groups: jsonb("groups").$type<string[]>(),
  lastLogin: text("last_login"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

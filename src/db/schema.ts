import { jsonb, pgTable, text } from "drizzle-orm/pg-core"

export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id").primaryKey(),
  language: text("language").default("en"),
  uiPreferences: jsonb("ui_preferences"),
  customBenchmarks: jsonb("custom_benchmarks").default([]),
  customTimeframes: jsonb("custom_timeframes").default([]),
  onboardingStatus: jsonb("onboarding_status").default({ completed: false }),
  onboardingDraft: jsonb("onboarding_draft").default({ draft: null }),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

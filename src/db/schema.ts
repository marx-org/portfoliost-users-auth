import { sqliteTable, text } from "drizzle-orm/sqlite-core"

export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id").primaryKey(),
  language: text("language").default("en"),
  uiPreferences: text("ui_preferences", { mode: "json" }),
  customBenchmarks: text("custom_benchmarks", { mode: "json" }).default("[]"),
  customTimeframes: text("custom_timeframes", { mode: "json" }).default("[]"),
  onboardingStatus: text("onboarding_status", { mode: "json" }).default(
    '{"completed":false}'
  ),
  onboardingDraft: text("onboarding_draft", { mode: "json" }).default(
    '{"draft":null}'
  ),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
})

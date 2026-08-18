import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createClient, type Client } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import { eq } from "drizzle-orm"
import { userPreferences } from "./schema.js"

function createTestDb() {
  const client = createClient({ url: ":memory:" })
  return { db: drizzle(client), client }
}

describe("user_preferences schema", () => {
  let testCtx: ReturnType<typeof createTestDb>

  beforeEach(async () => {
    testCtx = createTestDb()
    await testCtx.client.execute(
      `CREATE TABLE user_preferences (
        user_id text PRIMARY KEY NOT NULL,
        language text DEFAULT 'en',
        ui_preferences text,
        custom_benchmarks text DEFAULT '[]',
        custom_timeframes text DEFAULT '[]',
        onboarding_status text DEFAULT '{"completed":false}',
        onboarding_draft text DEFAULT '{"draft":null}',
        created_at text NOT NULL,
        updated_at text NOT NULL
      )`
    )
  })

  afterEach(async () => {
    await testCtx.client.close()
  })

  it("inserts and reads a user preferences row", async () => {
    const now = new Date().toISOString()
    await testCtx.db
      .insert(userPreferences)
      .values({
        userId: "user-1",
        language: "en",
        uiPreferences: { charts: {}, tables: {} },
        createdAt: now,
        updatedAt: now,
      })

    const row = await testCtx.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, "user-1"))

    expect(row).toHaveLength(1)
    expect(row[0].userId).toBe("user-1")
    expect(row[0].language).toBe("en")
    expect(row[0].uiPreferences).toEqual({ charts: {}, tables: {} })
  })

  it("upserts on conflict", async () => {
    const now = new Date().toISOString()
    await testCtx.db
      .insert(userPreferences)
      .values({ userId: "user-1", language: "en", createdAt: now, updatedAt: now })

    await testCtx.db
      .insert(userPreferences)
      .values({ userId: "user-1", language: "de", createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { language: "de", updatedAt: now },
      })

    const row = await testCtx.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, "user-1"))

    expect(row).toHaveLength(1)
    expect(row[0].language).toBe("de")
  })
})

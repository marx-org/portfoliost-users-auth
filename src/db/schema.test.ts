import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { eq } from "drizzle-orm"
import { userPreferences } from "./schema.js"
import { createTestDb } from "./test-db.js"

describe("user_preferences schema", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>

  beforeEach(async () => {
    ctx = await createTestDb()
  })

  afterEach(async () => {
    await ctx.client.close()
  })

  it("inserts and reads a user preferences row", async () => {
    const now = new Date().toISOString()
    await ctx.db.insert(userPreferences).values({
      userId: "user-1",
      language: "en",
      uiPreferences: { charts: {}, tables: {} },
      createdAt: now,
      updatedAt: now,
    })

    const rows = await ctx.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, "user-1"))

    expect(rows).toHaveLength(1)
    expect(rows[0].userId).toBe("user-1")
    expect(rows[0].language).toBe("en")
    expect(rows[0].uiPreferences).toEqual({ charts: {}, tables: {} })
  })

  it("applies jsonb column defaults", async () => {
    const now = new Date().toISOString()
    await ctx.db
      .insert(userPreferences)
      .values({ userId: "user-1", createdAt: now, updatedAt: now })

    const rows = await ctx.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, "user-1"))

    expect(rows[0].language).toBe("en")
    expect(rows[0].customBenchmarks).toEqual([])
    expect(rows[0].customTimeframes).toEqual([])
    expect(rows[0].onboardingStatus).toEqual({ completed: false })
    expect(rows[0].onboardingDraft).toEqual({ draft: null })
  })

  it("upserts on conflict", async () => {
    const now = new Date().toISOString()
    await ctx.db
      .insert(userPreferences)
      .values({ userId: "user-1", language: "en", createdAt: now, updatedAt: now })

    await ctx.db
      .insert(userPreferences)
      .values({ userId: "user-1", language: "de", createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { language: "de", updatedAt: now },
      })

    const rows = await ctx.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, "user-1"))

    expect(rows).toHaveLength(1)
    expect(rows[0].language).toBe("de")
  })
})

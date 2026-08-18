import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { getDb } from "../db/index.js"
import { userPreferences } from "../db/schema.js"
import { userIdentityMiddleware } from "../context.js"
import type { drizzle } from "drizzle-orm/libsql"

type DB = ReturnType<typeof drizzle>

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return value as T
}

async function getOrCreatePreferences(db: DB, userId: string) {
  const now = new Date().toISOString()
  await db
    .insert(userPreferences)
    .values({ userId, createdAt: now, updatedAt: now })
    .onConflictDoNothing()

  const rows = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
  return rows[0]
}

export function createUsersRoutes(db?: DB) {
  const users = new Hono()
  users.use("*", userIdentityMiddleware)

  const getDbInstance = () => db ?? getDb()

  users.get("/profile", async (c) => {
    const identity = c.get("userIdentity")
    const d = getDbInstance()
    const prefs = await getOrCreatePreferences(d, identity.id)

    return c.json({
      id: identity.id,
      email: identity.email,
      firstName: identity.firstName,
      lastName: identity.lastName,
      language: prefs.language ?? identity.language,
      createdAt: identity.createdAt,
      updatedAt: prefs.updatedAt,
      isDemoUser: false,
    })
  })

  users.patch("/profile", async (c) => {
    const identity = c.get("userIdentity")
    const body = await c.req.json()
    const now = new Date().toISOString()
    const d = getDbInstance()

    await getOrCreatePreferences(d, identity.id)

    const allowedFields: Record<string, string> = {}
    if (body.language !== undefined) allowedFields.language = body.language

    if (Object.keys(allowedFields).length > 0) {
      allowedFields.updatedAt = now
      await d
        .update(userPreferences)
        .set(allowedFields)
        .where(eq(userPreferences.userId, identity.id))
    }

    const prefs = await getOrCreatePreferences(d, identity.id)

    return c.json({
      id: identity.id,
      email: identity.email,
      firstName: identity.firstName,
      lastName: identity.lastName,
      language: prefs.language ?? identity.language,
      createdAt: identity.createdAt,
      updatedAt: prefs.updatedAt,
      isDemoUser: false,
    })
  })

  users.get("/preferences", async (c) => {
    const identity = c.get("userIdentity")
    const d = getDbInstance()
    const prefs = await getOrCreatePreferences(d, identity.id)

    return c.json({
      id: prefs.userId,
      userId: prefs.userId,
      uiPreferences: parseJson(prefs.uiPreferences, {}),
      createdAt: prefs.createdAt,
      updatedAt: prefs.updatedAt,
    })
  })

  users.patch("/preferences", async (c) => {
    const identity = c.get("userIdentity")
    const body = await c.req.json()
    const now = new Date().toISOString()
    const d = getDbInstance()

    await getOrCreatePreferences(d, identity.id)

    const set: Record<string, unknown> = { updatedAt: now }
    if (body.uiPreferences !== undefined) set.uiPreferences = JSON.stringify(body.uiPreferences)

    await d
      .update(userPreferences)
      .set(set)
      .where(eq(userPreferences.userId, identity.id))

    const prefs = await getOrCreatePreferences(d, identity.id)

    return c.json({
      id: prefs.userId,
      userId: prefs.userId,
      uiPreferences: parseJson(prefs.uiPreferences, {}),
      createdAt: prefs.createdAt,
      updatedAt: prefs.updatedAt,
    })
  })

  users.get("/preferences/custom-benchmarks", async (c) => {
    const identity = c.get("userIdentity")
    const d = getDbInstance()
    const prefs = await getOrCreatePreferences(d, identity.id)
    return c.json({ items: parseJson(prefs.customBenchmarks, []) })
  })

  users.get("/preferences/custom-timeframes", async (c) => {
    const identity = c.get("userIdentity")
    const d = getDbInstance()
    const prefs = await getOrCreatePreferences(d, identity.id)
    return c.json({ items: parseJson(prefs.customTimeframes, []) })
  })

  users.get("/onboarding/status", async (c) => {
    const identity = c.get("userIdentity")
    const d = getDbInstance()
    const prefs = await getOrCreatePreferences(d, identity.id)
    return c.json(parseJson(prefs.onboardingStatus, { completed: false }))
  })

  users.patch("/onboarding/status", async (c) => {
    const identity = c.get("userIdentity")
    const body = await c.req.json()
    const now = new Date().toISOString()
    const d = getDbInstance()

    await getOrCreatePreferences(d, identity.id)

    await d
      .update(userPreferences)
      .set({ onboardingStatus: JSON.stringify(body), updatedAt: now })
      .where(eq(userPreferences.userId, identity.id))

    return c.json(body)
  })

  users.get("/onboarding/draft", async (c) => {
    const identity = c.get("userIdentity")
    const d = getDbInstance()
    const prefs = await getOrCreatePreferences(d, identity.id)
    return c.json(parseJson(prefs.onboardingDraft, { draft: null }))
  })

  users.patch("/onboarding/draft", async (c) => {
    const identity = c.get("userIdentity")
    const body = await c.req.json()
    const now = new Date().toISOString()
    const d = getDbInstance()

    await getOrCreatePreferences(d, identity.id)

    await d
      .update(userPreferences)
      .set({ onboardingDraft: JSON.stringify(body), updatedAt: now })
      .where(eq(userPreferences.userId, identity.id))

    return c.json(body)
  })

  users.post("/change-password", async (c) => {
    return c.json(
      { error: "Forbidden", message: "Password management is handled by the identity provider" },
      403
    )
  })

  users.delete("/clear-data", async (c) => {
    const identity = c.get("userIdentity")
    const d = getDbInstance()
    await d.delete(userPreferences).where(eq(userPreferences.userId, identity.id))
    return c.body(null, 204)
  })

  users.delete("/account", async (c) => {
    const identity = c.get("userIdentity")
    const d = getDbInstance()
    await d.delete(userPreferences).where(eq(userPreferences.userId, identity.id))
    return c.body(null, 204)
  })

  return users
}

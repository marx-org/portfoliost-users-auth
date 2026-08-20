import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { openApi } from "hono-zod-openapi"
import { getDb } from "../db/index.js"
import { userPreferences } from "../db/schema.js"
import { userIdentityMiddleware } from "../auth.js"
import type { drizzle } from "drizzle-orm/libsql"
import {
  UserProfileSchema,
  UpdateProfileRequestSchema,
  UserPreferencesSchema,
  UpdatePreferencesRequestSchema,
  CustomBenchmarksResponseSchema,
  CustomTimeframesResponseSchema,
  OnboardingStatusSchema,
  OnboardingDraftSchema,
  ErrorResponseSchema,
} from "../schemas/users.js"

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

  users.get(
    "/profile",
    openApi({
      tags: ["Users"],
      summary: "Get user profile",
      operationId: "getUserProfile",
      responses: {
        200: {
          description: "User profile",
          content: { "application/json": { schema: UserProfileSchema } },
        },
      },
    }),
    async (c) => {
      const identity = c.get("userIdentity")
      const d = getDbInstance()
      const prefs = await getOrCreatePreferences(d, identity.id)

      return c.json({
        id: identity.id,
        email: identity.email,
        firstName: identity.firstName,
        lastName: identity.lastName,
        avatarUrl: identity.avatarUrl,
        groups: identity.groups,
        language: prefs.language ?? "en",
        createdAt: prefs.createdAt,
        updatedAt: prefs.updatedAt,
        isDemoUser: false,
      })
    }
  )

  users.patch(
    "/profile",
    openApi({
      tags: ["Users"],
      summary: "Update user profile",
      operationId: "updateUserProfile",
      responses: {
        200: {
          description: "Updated profile",
          content: { "application/json": { schema: UserProfileSchema } },
        },
      },
      request: {
        json: UpdateProfileRequestSchema,
      },
    }),
    async (c) => {
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
        avatarUrl: identity.avatarUrl,
        groups: identity.groups,
        language: prefs.language ?? "en",
        createdAt: prefs.createdAt,
        updatedAt: prefs.updatedAt,
        isDemoUser: false,
      })
    }
  )

  users.get(
    "/preferences",
    openApi({
      tags: ["Users"],
      summary: "Get user preferences",
      operationId: "getUserPreferences",
      responses: {
        200: {
          description: "User preferences",
          content: { "application/json": { schema: UserPreferencesSchema } },
        },
      },
    }),
    async (c) => {
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
    }
  )

  users.patch(
    "/preferences",
    openApi({
      tags: ["Users"],
      summary: "Update user preferences",
      operationId: "updateUserPreferences",
      responses: {
        200: {
          description: "Updated preferences",
          content: { "application/json": { schema: UserPreferencesSchema } },
        },
      },
      request: {
        json: UpdatePreferencesRequestSchema,
      },
    }),
    async (c) => {
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
    }
  )

  users.get(
    "/preferences/custom-benchmarks",
    openApi({
      tags: ["Users"],
      summary: "Get custom benchmarks",
      operationId: "getCustomBenchmarks",
      responses: {
        200: {
          description: "Custom benchmarks",
          content: { "application/json": { schema: CustomBenchmarksResponseSchema } },
        },
      },
    }),
    async (c) => {
      const identity = c.get("userIdentity")
      const d = getDbInstance()
      const prefs = await getOrCreatePreferences(d, identity.id)
      return c.json({ items: parseJson(prefs.customBenchmarks, []) })
    }
  )

  users.get(
    "/preferences/custom-timeframes",
    openApi({
      tags: ["Users"],
      summary: "Get custom timeframes",
      operationId: "getCustomTimeframes",
      responses: {
        200: {
          description: "Custom timeframes",
          content: { "application/json": { schema: CustomTimeframesResponseSchema } },
        },
      },
    }),
    async (c) => {
      const identity = c.get("userIdentity")
      const d = getDbInstance()
      const prefs = await getOrCreatePreferences(d, identity.id)
      return c.json({ items: parseJson(prefs.customTimeframes, []) })
    }
  )

  users.get(
    "/onboarding/status",
    openApi({
      tags: ["Users"],
      summary: "Get onboarding status",
      operationId: "getOnboardingStatus",
      responses: {
        200: {
          description: "Onboarding status",
          content: { "application/json": { schema: OnboardingStatusSchema } },
        },
      },
    }),
    async (c) => {
      const identity = c.get("userIdentity")
      const d = getDbInstance()
      const prefs = await getOrCreatePreferences(d, identity.id)
      return c.json(parseJson(prefs.onboardingStatus, { completed: false }))
    }
  )

  users.patch(
    "/onboarding/status",
    openApi({
      tags: ["Users"],
      summary: "Update onboarding status",
      operationId: "updateOnboardingStatus",
      responses: {
        200: {
          description: "Updated onboarding status",
          content: { "application/json": { schema: OnboardingStatusSchema } },
        },
      },
      request: {
        json: OnboardingStatusSchema,
      },
    }),
    async (c) => {
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
    }
  )

  users.get(
    "/onboarding/draft",
    openApi({
      tags: ["Users"],
      summary: "Get onboarding draft",
      operationId: "getOnboardingDraft",
      responses: {
        200: {
          description: "Onboarding draft",
          content: { "application/json": { schema: OnboardingDraftSchema } },
        },
      },
    }),
    async (c) => {
      const identity = c.get("userIdentity")
      const d = getDbInstance()
      const prefs = await getOrCreatePreferences(d, identity.id)
      return c.json(parseJson(prefs.onboardingDraft, { draft: null }))
    }
  )

  users.patch(
    "/onboarding/draft",
    openApi({
      tags: ["Users"],
      summary: "Update onboarding draft",
      operationId: "updateOnboardingDraft",
      responses: {
        200: {
          description: "Updated onboarding draft",
          content: { "application/json": { schema: OnboardingDraftSchema } },
        },
      },
      request: {
        json: OnboardingDraftSchema,
      },
    }),
    async (c) => {
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
    }
  )

  users.post(
    "/change-password",
    openApi({
      tags: ["Users"],
      summary: "Change password (blocked — managed by identity provider)",
      operationId: "changePassword",
      responses: {
        403: {
          description: "Password management handled by identity provider",
          content: { "application/json": { schema: ErrorResponseSchema } },
        },
      },
    }),
    async (c) => {
      return c.json(
        { error: "Forbidden", message: "Password management is handled by the identity provider" },
        403
      )
    }
  )

  users.delete(
    "/clear-data",
    openApi({
      tags: ["Users"],
      summary: "Clear user data",
      operationId: "clearUserData",
      responses: {
        204: { description: "Data cleared" },
      },
    }),
    async (c) => {
      const identity = c.get("userIdentity")
      const d = getDbInstance()
      await d.delete(userPreferences).where(eq(userPreferences.userId, identity.id))
      return c.body(null, 204)
    }
  )

  users.delete(
    "/account",
    openApi({
      tags: ["Users"],
      summary: "Delete user account",
      operationId: "deleteAccount",
      responses: {
        204: { description: "Account deleted" },
      },
    }),
    async (c) => {
      const identity = c.get("userIdentity")
      const d = getDbInstance()
      await d.delete(userPreferences).where(eq(userPreferences.userId, identity.id))
      return c.body(null, 204)
    }
  )

  return users
}

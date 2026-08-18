import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createClient, type Client } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import { userPreferences } from "../db/schema.js"
import { Hono } from "hono"
import { createUsersRoutes } from "./users.js"

function createTestApp() {
  const client = createClient({ url: ":memory:" })
  const db = drizzle(client)
  const app = new Hono()
  app.route("/api/users", createUsersRoutes(db))
  return { app, client }
}

const headers = {
  "X-User-Id": "user-1",
  "X-User-Email": "test@example.com",
  "X-User-FirstName": "Test",
  "X-User-LastName": "User",
  "X-User-Language": "en",
  "X-User-CreatedAt": "2026-01-01T00:00:00Z",
}

describe("GET /api/users/profile", () => {
  let ctx: ReturnType<typeof createTestApp>

  beforeEach(async () => {
    ctx = createTestApp()
    await ctx.client.execute(
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
    await ctx.client.close()
  })

  it("returns user profile merged from headers + DB", async () => {
    const res = await ctx.app.request("/api/users/profile", { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe("user-1")
    expect(body.email).toBe("test@example.com")
    expect(body.firstName).toBe("Test")
    expect(body.lastName).toBe("User")
    expect(body.language).toBe("en")
    expect(body.isDemoUser).toBe(false)
  })

  it("returns 401 without identity headers", async () => {
    const res = await ctx.app.request("/api/users/profile")
    expect(res.status).toBe(401)
  })
})

describe("PATCH /api/users/profile", () => {
  let ctx: ReturnType<typeof createTestApp>

  beforeEach(async () => {
    ctx = createTestApp()
    await ctx.client.execute(
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
    await ctx.client.close()
  })

  it("updates language", async () => {
    const res = await ctx.app.request("/api/users/profile", {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ language: "de" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.language).toBe("de")
  })

  it("ignores identity fields", async () => {
    const res = await ctx.app.request("/api/users/profile", {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "Hacked", email: "hacked@evil.com" }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.firstName).toBe("Test")
    expect(body.email).toBe("test@example.com")
  })
})

describe("GET /api/users/preferences", () => {
  let ctx: ReturnType<typeof createTestApp>

  beforeEach(async () => {
    ctx = createTestApp()
    await ctx.client.execute(
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
    await ctx.client.close()
  })

  it("returns preferences with defaults", async () => {
    const res = await ctx.app.request("/api/users/preferences", { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.userId).toBe("user-1")
    expect(body.uiPreferences).toEqual({})
  })
})

describe("PATCH /api/users/preferences", () => {
  let ctx: ReturnType<typeof createTestApp>

  beforeEach(async () => {
    ctx = createTestApp()
    await ctx.client.execute(
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
    await ctx.client.close()
  })

  it("updates uiPreferences", async () => {
    const prefs = { charts: { portfolioAnalytics: { defaultTimeframe: "1M" } } }
    const res = await ctx.app.request("/api/users/preferences", {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ uiPreferences: prefs }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.uiPreferences).toEqual(prefs)
  })
})

describe("GET /api/users/preferences/custom-benchmarks", () => {
  let ctx: ReturnType<typeof createTestApp>

  beforeEach(async () => {
    ctx = createTestApp()
    await ctx.client.execute(
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
    await ctx.client.close()
  })

  it("returns empty items by default", async () => {
    const res = await ctx.app.request("/api/users/preferences/custom-benchmarks", { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [] })
  })
})

describe("GET /api/users/onboarding/status", () => {
  let ctx: ReturnType<typeof createTestApp>

  beforeEach(async () => {
    ctx = createTestApp()
    await ctx.client.execute(
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
    await ctx.client.close()
  })

  it("returns not completed by default", async () => {
    const res = await ctx.app.request("/api/users/onboarding/status", { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.completed).toBe(false)
  })
})

describe("POST /api/users/change-password", () => {
  it("returns 403", async () => {
    const { app } = createTestApp()
    const res = await app.request("/api/users/change-password", {
      method: "POST",
      headers,
    })
    expect(res.status).toBe(403)
  })
})

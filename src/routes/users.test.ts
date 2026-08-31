import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Hono } from "hono"
import { createUsersRoutes } from "./users.js"
import { createTestDb } from "../db/test-db.js"

function createTestApp(db: Awaited<ReturnType<typeof createTestDb>>["db"]) {
  const app = new Hono()
  app.route("/api/users", createUsersRoutes(db))
  return app
}

const headers = {
  "X-User-Id": "user-1",
  "X-User-Email": "test@example.com",
  "X-User-FirstName": "Test",
  "X-User-LastName": "User",
  "X-User-Language": "en",
  "X-User-CreatedAt": "2026-01-01T00:00:00Z",
}

describe("Users Routes", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>
  let app: Hono

  beforeEach(async () => {
    ctx = await createTestDb()
    app = createTestApp(ctx.db)
  })

  afterEach(async () => {
    await ctx.client.close()
  })

  describe("GET /api/users/profile", () => {
    it("returns user profile merged from headers + DB", async () => {
      const res = await app.request("/api/users/profile", { headers })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.id).toBe("user-1")
      expect(body.email).toBe("test@example.com")
      expect(body.firstName).toBe("Test")
      expect(body.lastName).toBe("User")
      expect(body.language).toBe("en")
      expect(body.isDemoUser).toBe(false)
      expect(body.recentSearches).toEqual([])
    })

    it("returns 401 without identity headers", async () => {
      const res = await app.request("/api/users/profile")
      expect(res.status).toBe(401)
    })
  })

  describe("PATCH /api/users/profile", () => {
    it("updates language", async () => {
      const res = await app.request("/api/users/profile", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ language: "de" }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.language).toBe("de")
    })

    it("ignores identity fields", async () => {
      const res = await app.request("/api/users/profile", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ firstName: "Hacked", email: "hacked@evil.com" }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.firstName).toBe("Test")
      expect(body.email).toBe("test@example.com")
    })

    it("updates recentSearches as an LRU queue", async () => {
      const res = await app.request("/api/users/profile", {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ recentSearches: ["MSFT", "AAPL"] }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.recentSearches).toEqual(["MSFT", "AAPL"])
    })
  })

  describe("GET /api/users/preferences", () => {
    it("returns preferences with defaults", async () => {
      const res = await app.request("/api/users/preferences", { headers })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.userId).toBe("user-1")
      expect(body.uiPreferences).toEqual({})
    })
  })

  describe("PATCH /api/users/preferences", () => {
    it("updates uiPreferences", async () => {
      const prefs = { charts: { portfolioAnalytics: { defaultTimeframe: "1M" } } }
      const res = await app.request("/api/users/preferences", {
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
    it("returns empty items by default", async () => {
      const res = await app.request("/api/users/preferences/custom-benchmarks", { headers })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ items: [] })
    })
  })

  describe("GET /api/users/onboarding/status", () => {
    it("returns not completed by default", async () => {
      const res = await app.request("/api/users/onboarding/status", { headers })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.completed).toBe(false)
    })
  })

  describe("POST /api/users/change-password", () => {
    it("returns 403", async () => {
      const res = await app.request("/api/users/change-password", {
        method: "POST",
        headers,
      })
      expect(res.status).toBe(403)
    })
  })
})

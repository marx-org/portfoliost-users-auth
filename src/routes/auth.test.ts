import { describe, it, expect, vi, beforeEach } from "vitest"
import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import { Hono } from "hono"
import { createAuthRoutes } from "./auth.js"

function createTestApp() {
  const client = createClient({ url: ":memory:" })
  const db = drizzle(client)
  const app = new Hono()
  app.route("/api/auth", createAuthRoutes(db))
  return { app, client }
}

describe("Auth Routes", () => {
  let ctx: ReturnType<typeof createTestApp>

  beforeEach(async () => {
    ctx = createTestApp()
    await ctx.client.execute(`
      CREATE TABLE IF NOT EXISTS user_preferences (
        user_id TEXT PRIMARY KEY,
        language TEXT NOT NULL DEFAULT 'en',
        ui_preferences TEXT,
        custom_benchmarks TEXT,
        custom_timeframes TEXT,
        onboarding_status TEXT,
        onboarding_draft TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `)
  })

  describe("POST /api/auth/token", () => {
    it("returns 400 for missing fields", async () => {
      const res = await ctx.app.request("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it("returns mock token in development mode", async () => {
      process.env.NODE_ENV = "development"
      const res = await ctx.app.request("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "test-code",
          code_verifier: "test-verifier",
          redirect_uri: "http://localhost:3000/auth/callback",
        }),
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.access_token).toBeDefined()
      expect(data.token_type).toBe("Bearer")
      expect(data.user).toBeDefined()
      expect(data.user.email).toBe("dev@example.com")
    })
  })

  describe("POST /api/auth/logout", () => {
    it("returns success", async () => {
      const res = await ctx.app.request("/api/auth/logout", {
        method: "POST",
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
    })
  })
})

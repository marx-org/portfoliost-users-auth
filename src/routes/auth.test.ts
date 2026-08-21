import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Hono } from "hono"
import { createAuthRoutes } from "./auth.js"
import { createTestDb } from "../db/test-db.js"

describe("Auth Routes", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>
  let app: Hono

  beforeEach(async () => {
    ctx = await createTestDb()
    app = new Hono()
    app.route("/api/auth", createAuthRoutes(ctx.db))
  })

  afterEach(async () => {
    await ctx.client.close()
  })

  describe("POST /api/auth/token", () => {
    it("returns 400 for missing fields", async () => {
      const res = await app.request("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })

    it("returns mock token in development mode", async () => {
      process.env.NODE_ENV = "development"
      const res = await app.request("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "test-code",
          verifier: "test-verifier",
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
      const res = await app.request("/api/auth/logout", {
        method: "POST",
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.success).toBe(true)
    })
  })
})

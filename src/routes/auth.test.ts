import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Hono } from "hono"
import { eq } from "drizzle-orm"

import { createAuthRoutes } from "./auth.js"
import { refreshSessions } from "../db/schema.js"
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

    it("includes groups from id_token claims in the user object", async () => {
      process.env.NODE_ENV = "production"
      process.env.POCKETID_TOKEN_URL = "https://pocket-id.example/oauth2/token"
      process.env.POCKETID_CLIENT_ID = "test-client"
      delete process.env.POCKETID_CLIENT_SECRET

      const { SignJWT, generateKeyPair } = await import("jose")
      const alg = "ES256"
      const { privateKey } = await generateKeyPair(alg)
      const idToken = await new SignJWT({
        sub: "user-42",
        email: "alice@example.com",
        given_name: "Alice",
        family_name: "Smith",
        groups: ["portfoliost_user", "portfoliost_admin"],
      })
        .setProtectedHeader({ alg })
        .setIssuer("https://pocket-id.example")
        .setAudience("test-client")
        .setExpirationTime("5m")
        .sign(privateKey)

      const origFetch = globalThis.fetch
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ access_token: "at", token_type: "Bearer", expires_in: 3600, id_token: idToken }), {
          headers: { "content-type": "application/json" },
        })) as typeof fetch

      try {
        const res = await app.request("/api/auth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: "real-code",
            verifier: "real-verifier",
            redirect_uri: "https://app.example/auth/callback",
          }),
        })
        expect(res.status).toBe(200)
        const data = await res.json()
        expect(data.user.id).toBe("user-42")
        expect(data.user.groups).toEqual(["portfoliost_user", "portfoliost_admin"])
      } finally {
        globalThis.fetch = origFetch
        delete process.env.POCKETID_TOKEN_URL
        delete process.env.POCKETID_CLIENT_ID
        process.env.NODE_ENV = "test"
      }
    })

    it("stores the refresh token hashed, keyed by the id_token jti, and never returns it (§77.2)", async () => {
      process.env.NODE_ENV = "production"
      process.env.POCKETID_TOKEN_URL = "https://pocket-id.example/oauth2/token"
      process.env.POCKETID_CLIENT_ID = "test-client"
      delete process.env.POCKETID_CLIENT_SECRET

      const { SignJWT, generateKeyPair } = await import("jose")
      const alg = "ES256"
      const { privateKey } = await generateKeyPair(alg)
      const idToken = await new SignJWT({
        sub: "user-42",
        email: "alice@example.com",
        given_name: "Alice",
        family_name: "Smith",
        groups: ["portfoliost_user"],
      })
        .setProtectedHeader({ alg })
        .setIssuer("https://pocket-id.example")
        .setAudience("test-client")
        .setJti("jti-abc")
        .setExpirationTime("5m")
        .sign(privateKey)

      const REFRESH = "super-secret-refresh-token"
      const origFetch = globalThis.fetch
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            access_token: "at",
            token_type: "Bearer",
            expires_in: 3600,
            id_token: idToken,
            refresh_token: REFRESH,
          }),
          { headers: { "content-type": "application/json" } }
        )) as typeof fetch

      try {
        const res = await app.request("/api/auth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: "real-code",
            verifier: "real-verifier",
            redirect_uri: "https://app.example/auth/callback",
          }),
        })
        expect(res.status).toBe(200)
        const raw = await res.text()

        // The refresh token must never leave the backend.
        expect(raw).not.toContain(REFRESH)
        expect(JSON.parse(raw)).not.toHaveProperty("refresh_token")

        const rows = await ctx.db
          .select()
          .from(refreshSessions)
          .where(eq(refreshSessions.idTokenJti, "jti-abc"))
        expect(rows).toHaveLength(1)
        expect(rows[0].userId).toBe("user-42")
        // Stored in the clear on purpose — the refresh grant must be able to
        // replay it verbatim to PocketID. What must not leak is the HTTP
        // response, asserted above.
        expect(rows[0].refreshToken).toBe(REFRESH)
      } finally {
        globalThis.fetch = origFetch
        delete process.env.POCKETID_TOKEN_URL
        delete process.env.POCKETID_CLIENT_ID
        process.env.NODE_ENV = "test"
      }
    })

    it("still returns 200 and stores nothing when PocketID issues no refresh token", async () => {
      process.env.NODE_ENV = "production"
      process.env.POCKETID_TOKEN_URL = "https://pocket-id.example/oauth2/token"
      process.env.POCKETID_CLIENT_ID = "test-client"
      delete process.env.POCKETID_CLIENT_SECRET

      const { SignJWT, generateKeyPair } = await import("jose")
      const alg = "ES256"
      const { privateKey } = await generateKeyPair(alg)
      const idToken = await new SignJWT({ sub: "user-7", email: "b@example.com" })
        .setProtectedHeader({ alg })
        .setIssuer("https://pocket-id.example")
        .setAudience("test-client")
        .setExpirationTime("5m")
        .sign(privateKey)

      const origFetch = globalThis.fetch
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ access_token: "at", token_type: "Bearer", expires_in: 3600, id_token: idToken }), {
          headers: { "content-type": "application/json" },
        })) as typeof fetch

      try {
        const res = await app.request("/api/auth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: "c",
            verifier: "v",
            redirect_uri: "https://app.example/auth/callback",
          }),
        })
        expect(res.status).toBe(200)
        const rows = await ctx.db.select().from(refreshSessions)
        expect(rows).toHaveLength(0)
      } finally {
        globalThis.fetch = origFetch
        delete process.env.POCKETID_TOKEN_URL
        delete process.env.POCKETID_CLIENT_ID
        process.env.NODE_ENV = "test"
      }
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

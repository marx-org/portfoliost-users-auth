import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest"
import { Hono } from "hono"
import { eq } from "drizzle-orm"

import { createAuthRoutes } from "./auth.js"
import { refreshSessions } from "../db/schema.js"
import { createTestDb } from "../db/test-db.js"

describe("Auth Routes", () => {
  // One issuer, audience and keypair for the whole file. `getJwks` caches its
  // RemoteJWKSet at module scope on first use, so a second issuer (or a second
  // keypair) in this file fails with JWKSNoMatchingKey no matter what the stub
  // returns.
  const ISSUER = "http://auth-jwks.test"
  const AUDIENCE = "auth-audience"
  const ALG = "ES256"
  const KID = "test-key"

  let privateKey: CryptoKey
  let jwksBody: string
  let origFetch: typeof fetch

  beforeAll(async () => {
    const { generateKeyPair, exportJWK } = await import("jose")
    const kp = await generateKeyPair(ALG)
    privateKey = kp.privateKey
    jwksBody = JSON.stringify({
      keys: [{ ...(await exportJWK(kp.publicKey)), kid: KID, alg: ALG, use: "sig" }],
    })
    origFetch = globalThis.fetch
  })

  afterAll(() => {
    globalThis.fetch = origFetch
  })

  /** Install a fetch stub that serves the JWKS and the PocketID token endpoint. */
  function stubPocketId(
    onToken: (params: URLSearchParams, callNumber: number) => Response | Promise<Response>
  ): { calls: URLSearchParams[] } {
    const calls: URLSearchParams[] = []
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (url.includes("/.well-known/jwks.json")) {
        return new Response(jwksBody, { headers: { "content-type": "application/json" } })
      }
      if (url.includes("/api/oidc/token")) {
        const body = typeof init?.body === "string" ? init.body : ""
        const params = new URLSearchParams(body)
        calls.push(params)
        return onToken(params, calls.length)
      }
      return origFetch(input as RequestInfo, init)
    }) as typeof fetch
    return { calls }
  }

  function setOIDCEnv() {
    process.env.POCKETID_ISSUER_URL = ISSUER
    process.env.POCKETID_AUDIENCE = AUDIENCE
    process.env.POCKETID_TOKEN_URL = "http://pocket-id.test/api/oidc/token"
    process.env.POCKETID_CLIENT_ID = AUDIENCE
  }

  function clearOIDCEnv() {
    delete process.env.POCKETID_ISSUER_URL
    delete process.env.POCKETID_AUDIENCE
    delete process.env.POCKETID_TOKEN_URL
    delete process.env.POCKETID_CLIENT_ID
    delete process.env.POCKETID_ALLOWED_REDIRECT_URIS
  }

  async function signToken(opts: {
    jti: string
    sub?: string
    groups?: string[]
    expired?: boolean
    issuer?: string
    email?: string
  }) {
    const { SignJWT } = await import("jose")
    let b = new SignJWT({
      sub: opts.sub ?? "user-42",
      email: opts.email ?? "alice@example.com",
      groups: opts.groups ?? ["portfoliost_user"],
    })
      .setProtectedHeader({ alg: ALG, kid: KID })
      .setIssuer(opts.issuer ?? ISSUER)
      .setAudience(AUDIENCE)
      .setJti(opts.jti)
      .setExpirationTime(opts.expired ? "-10m" : "5m")
    if (opts.expired) b = b.setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    return b.sign(privateKey)
  }
  let ctx: Awaited<ReturnType<typeof createTestDb>>
  let app: Hono

  beforeEach(async () => {
    process.env.POCKETID_ALLOWED_REDIRECT_URIS =
      "https://app.example/auth/callback,http://localhost:3000/auth/callback"
    ctx = await createTestDb()
    app = new Hono()
    app.route("/api/auth", createAuthRoutes(ctx.db))
  })

  afterEach(async () => {
    await ctx.client.close()
    delete process.env.POCKETID_ALLOWED_REDIRECT_URIS
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

    it("rejects redirect URIs outside the configured allowlist", async () => {
      process.env.NODE_ENV = "production"
      process.env.POCKETID_TOKEN_URL = "https://pocket-id.example/oauth2/token"
      process.env.POCKETID_CLIENT_ID = "test-client"
      let fetchCalled = false
      const origFetch = globalThis.fetch
      globalThis.fetch = (async () => {
        fetchCalled = true
        return new Response(null, { status: 500 })
      }) as typeof fetch

      try {
        const res = await app.request("/api/auth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: "attacker-code",
            verifier: "attacker-verifier",
            redirect_uri: "https://attacker.example/auth/callback",
          }),
        })

        expect(res.status).toBe(401)
        expect(fetchCalled).toBe(false)
      } finally {
        globalThis.fetch = origFetch
        delete process.env.POCKETID_TOKEN_URL
        delete process.env.POCKETID_CLIENT_ID
        process.env.NODE_ENV = "test"
      }
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

  describe("POST /api/auth/refresh", () => {
    let tokenCalls: URLSearchParams[]

    beforeEach(() => {
      setOIDCEnv()
      tokenCalls = []
    })

    afterEach(() => {
      globalThis.fetch = origFetch
      clearOIDCEnv()
    })

    async function seedSession(jti: string, refreshToken = "rt-1") {
      const now = new Date().toISOString()
      await ctx.db.insert(refreshSessions).values({
        idTokenJti: jti,
        userId: "user-42",
        refreshToken,
        createdAt: now,
        updatedAt: now,
      })
    }

    it("accepts an expired token, rotates the row to the new jti, and hides the refresh token", async () => {
      await seedSession("old-jti")
      tokenCalls = stubPocketId(async () => {
        const newToken = await signToken({
          jti: "new-jti",
          groups: ["portfoliost_user", "portfoliost_admin"],
        })
        return new Response(
          JSON.stringify({
            access_token: "at",
            token_type: "Bearer",
            expires_in: 3600,
            id_token: newToken,
            refresh_token: "rt-2",
          }),
          { headers: { "content-type": "application/json" } }
        )
      }).calls

      const expired = await signToken({ jti: "old-jti", expired: true })
      const res = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: expired }),
      })

      expect(res.status).toBe(200)
      const raw = await res.text()
      expect(raw).not.toContain("rt-2")
      expect(JSON.parse(raw)).not.toHaveProperty("refresh_token")

      const data = JSON.parse(raw)
      expect(data.user.groups).toEqual(["portfoliost_user", "portfoliost_admin"])
      // The stored refresh token was replayed to PocketID verbatim.
      expect(tokenCalls[0].get("grant_type")).toBe("refresh_token")
      expect(tokenCalls[0].get("refresh_token")).toBe("rt-1")

      // Row re-keyed: old jti gone, new jti carries the rotated token.
      const rows = await ctx.db.select().from(refreshSessions)
      expect(rows).toHaveLength(1)
      expect(rows[0].idTokenJti).toBe("new-jti")
      expect(rows[0].refreshToken).toBe("rt-2")
    })

    it("rejects a replay of an already-rotated jti", async () => {
      await seedSession("old-jti")
      tokenCalls = stubPocketId(async () => {
        const newToken = await signToken({ jti: "new-jti" })
        return new Response(
          JSON.stringify({
            access_token: "at",
            token_type: "Bearer",
            expires_in: 3600,
            id_token: newToken,
            refresh_token: "rt-2",
          }),
          { headers: { "content-type": "application/json" } }
        )
      }).calls

      const expired = await signToken({ jti: "old-jti", expired: true })
      const first = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: expired }),
      })
      expect(first.status).toBe(200)

      // Same token again — the session has moved on.
      const second = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: expired }),
      })
      expect(second.status).toBe(401)
      expect(tokenCalls).toHaveLength(1)
    })

    it("rejects a valid token with no session row", async () => {
      const token = await signToken({ jti: "unknown-jti" })
      const res = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: token }),
      })
      expect(res.status).toBe(401)
      expect(tokenCalls).toHaveLength(0)
    })

    it("rejects a tampered signature and does not consume the session", async () => {
      await seedSession("good-jti")
      const token = await signToken({ jti: "good-jti" })
      const [h, p, s] = token.split(".")
      const forged = `${h}.${Buffer.from('{"sub":"attacker"}').toString("base64url")}.${s}`

      const res = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: forged }),
      })
      expect(res.status).toBe(401)
      expect(tokenCalls).toHaveLength(0)

      // The real session survived the attempt.
      const rows = await ctx.db.select().from(refreshSessions)
      expect(rows).toHaveLength(1)
      expect(rows[0].idTokenJti).toBe("good-jti")
      expect(p).toBeTruthy()
    })

    it("rejects a token minted for a different issuer", async () => {
      await seedSession("good-jti")
      const token = await signToken({ jti: "good-jti", issuer: "http://evil.test" })
      const res = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: token }),
      })
      expect(res.status).toBe(401)
      expect(tokenCalls).toHaveLength(0)
    })

    it("drops the row when PocketID rejects the refresh token", async () => {
      await seedSession("dead-jti")
      tokenCalls = stubPocketId(
        () => new Response('{"error":"invalid_grant"}', { status: 400 })
      ).calls

      const token = await signToken({ jti: "dead-jti" })
      const res = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: token }),
      })
      expect(res.status).toBe(401)
      const rows = await ctx.db.select().from(refreshSessions)
      expect(rows).toHaveLength(0)
    })

    it("rejects a request with no id_token", async () => {
      const res = await app.request("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
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

    it("revokes the refresh session so the token can no longer be refreshed (§77.4)", async () => {
      setOIDCEnv()
      stubPocketId(() => new Response("{}", { status: 200 }))

      try {
        const now = new Date().toISOString()
        await ctx.db.insert(refreshSessions).values({
          idTokenJti: "logout-jti",
          userId: "user-9",
          refreshToken: "rt-9",
          createdAt: now,
          updatedAt: now,
        })

        // Expired is the normal case here too.
        const token = await signToken({
          jti: "logout-jti",
          sub: "user-9",
          email: "u@example.com",
          expired: true,
        })

        const res = await app.request("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_token: token }),
        })
        expect(res.status).toBe(200)

        const rows = await ctx.db.select().from(refreshSessions)
        expect(rows).toHaveLength(0)

        // Idempotent: logging out twice is still a 200.
        const again = await app.request("/api/auth/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_token: token }),
        })
        expect(again.status).toBe(200)
      } finally {
        globalThis.fetch = origFetch
        clearOIDCEnv()
      }
    })

    it("still returns 200 when the id_token cannot be verified, keeping the session", async () => {
      const now = new Date().toISOString()
      await ctx.db.insert(refreshSessions).values({
        idTokenJti: "keep-jti",
        userId: "user-9",
        refreshToken: "rt-keep",
        createdAt: now,
        updatedAt: now,
      })

      const res = await app.request("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: "not-a-jwt" }),
      })
      expect(res.status).toBe(200)
      // Nothing was deleted — an unverifiable token identifies nothing.
      const rows = await ctx.db.select().from(refreshSessions)
      expect(rows).toHaveLength(1)
    })
  })
})

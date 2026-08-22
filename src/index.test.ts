import { describe, it, expect } from "vitest"
import app from "./index.js"

describe("GET /health", () => {
  it("returns status ok", async () => {
    const res = await app.request("/health")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "ok" })
  })
})

describe("GET /api/doc", () => {
  it("returns valid OpenAPI document", async () => {
    const res = await app.request("/api/doc")
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(doc.openapi).toBe("3.1.0")
    expect(doc.info.title).toBe("Portfoliost API")
    expect(doc.info.version).toBe("1.0.0")
    expect(doc.paths["/users/profile"]).toBeDefined()
    expect(doc.paths["/users/preferences"]).toBeDefined()
    expect(doc.paths["/users/onboarding/status"]).toBeDefined()
    expect(doc.paths["/users/change-password"]).toBeDefined()
    expect(doc.paths["/users/clear-data"]).toBeDefined()
    expect(doc.paths["/users/account"]).toBeDefined()
  })
})

describe("GET /__meta", () => {
  it("returns module identity per D4", async () => {
    const res = await app.request("/__meta")
    expect(res.status).toBe(200)
    const meta = await res.json()
    expect(meta.service).toBe("users-auth")
    expect(meta.impl).toBe("real")
    expect(typeof meta.version).toBe("string")
    expect(meta.version.length).toBeGreaterThan(0)
  })
})

describe("GET /internal/verify", () => {
  it("rejects missing bearer token with 401", async () => {
    const res = await app.request("/internal/verify")
    expect(res.status).toBe(401)
  })

  it("rejects invalid bearer token with 401", async () => {
    const res = await app.request("/internal/verify", {
      headers: { Authorization: "Bearer not-a-jwt" },
    })
    expect(res.status).toBe(401)
  })

  it("returns 204 for a token signed by the issuer", async () => {
    const issuer = "http://users-auth-jwks.test"
    process.env.POCKETID_ISSUER_URL = issuer
    process.env.POCKETID_AUDIENCE = "test-audience"
    const { SignJWT, generateKeyPair, exportJWK } = await import("jose")
    const alg = "ES256"
    const { publicKey, privateKey } = await generateKeyPair(alg)
    const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: "test-key", alg, use: "sig" }] }
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(jwks), { headers: { "content-type": "application/json" } })) as typeof fetch
    try {
      const token = await new SignJWT({ email: "t@example.com" })
        .setProtectedHeader({ alg, kid: "test-key" })
        .setSubject("user-1")
        .setIssuer(issuer)
        .setAudience("test-audience")
        .setExpirationTime("5m")
        .sign(privateKey)
      const res = await app.request("/internal/verify", {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(res.status).toBe(204)
    } finally {
      globalThis.fetch = origFetch
    }
  })
})

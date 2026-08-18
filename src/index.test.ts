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

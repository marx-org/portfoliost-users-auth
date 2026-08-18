import { describe, it, expect } from "vitest"
import app from "./index.js"

describe("GET /health", () => {
  it("returns status ok", async () => {
    const res = await app.request("/health")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: "ok" })
  })
})

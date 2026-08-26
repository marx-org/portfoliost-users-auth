import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Hono } from "hono"
import { createAdminRoutes } from "./admin.js"
import { createTestDb } from "../db/test-db.js"
import { userPreferences } from "../db/schema.js"

describe("Admin Routes", () => {
  let ctx: Awaited<ReturnType<typeof createTestDb>>
  let app: Hono

  beforeEach(async () => {
    ctx = await createTestDb()
    app = new Hono()
    app.route("/api/users/admin", createAdminRoutes(ctx.db))
  })

  afterEach(async () => {
    await ctx.client.close()
  })

  function adminHeaders(): Record<string, string> {
    return {
      "X-User-Id": "admin-1",
      "X-User-Email": "admin@example.com",
      "X-User-Groups": "portfoliost_admin",
    }
  }

  it("rejects non-admin callers with 403", async () => {
    const res = await app.request("/api/users/admin/list", {
      headers: {
        "X-User-Id": "u1",
        "X-User-Email": "u@example.com",
        "X-User-Groups": "portfoliost_user",
      },
    })
    expect(res.status).toBe(403)
  })

  it("returns persisted identity fields per user", async () => {
    await ctx.db.insert(userPreferences).values([
      {
        userId: "user-a",
        email: "alice@example.com",
        firstName: "Alice",
        lastName: "Smith",
        groups: ["portfoliost_user", "portfoliost_admin"],
        lastLogin: "2026-08-25T10:00:00Z",
        createdAt: "2026-08-01T10:00:00Z",
        updatedAt: "2026-08-25T10:00:00Z",
      },
      {
        userId: "user-b",
        createdAt: "2026-08-22T09:00:00Z",
        updatedAt: "2026-08-22T09:00:00Z",
      },
    ])

    const res = await app.request("/api/users/admin/list", { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.pagination.total).toBe(2)
    expect(data.items).toEqual([
      {
        userId: "user-a",
        email: "alice@example.com",
        firstName: "Alice",
        lastName: "Smith",
        groups: ["portfoliost_user", "portfoliost_admin"],
        lastLogin: "2026-08-25T10:00:00Z",
        createdAt: "2026-08-01T10:00:00Z",
      },
      {
        userId: "user-b",
        email: null,
        firstName: null,
        lastName: null,
        groups: null,
        lastLogin: null,
        createdAt: "2026-08-22T09:00:00Z",
      },
    ])
  })

  it("search matches email as well as userId prefix", async () => {
    await ctx.db.insert(userPreferences).values([
      { userId: "user-a", email: "alice@example.com", createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-01T10:00:00Z" },
      { userId: "user-b", email: "bob@example.com", createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-01T10:00:00Z" },
    ])

    const res = await app.request("/api/users/admin/list?search=alice", { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.pagination.total).toBe(1)
    expect(data.items[0].userId).toBe("user-a")
  })
})

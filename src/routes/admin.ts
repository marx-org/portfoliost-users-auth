import { Hono } from "hono"
import { userIdentityMiddleware, requireGroup } from "../auth.js"
import { getDb, type DB } from "../db/index.js"
import { userPreferences } from "../db/schema.js"
import { sql, asc, like, count } from "drizzle-orm"

export function createAdminRoutes(db?: DB) {
  const admin = new Hono()
  admin.use("*", userIdentityMiddleware, requireGroup("portfoliost_admin"))

  admin.get("/list", async (c) => {
    const d = db ?? getDb()
    const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10))
    const perPage = Math.min(200, Math.max(1, parseInt(c.req.query("per_page") ?? "50", 10)))
    const search = c.req.query("search")

    const where = search ? like(userPreferences.userId, `${search}%`) : undefined

    const countResult = await d.execute(
      sql`SELECT COUNT(*) as count FROM users_auth.user_preferences ${where ? sql`WHERE ${where}` : sql``}`
    )
    const countRows = (Array.isArray(countResult) ? countResult : (countResult as unknown as { rows: { count: string }[] }).rows) as { count: string }[]
    const total = parseInt(countRows[0]?.count ?? "0", 10)
    const totalPages = Math.ceil(total / perPage)

    const offset = (page - 1) * perPage
    const rows = await d.execute(
      sql`SELECT user_id, created_at, updated_at FROM users_auth.user_preferences
          ${where ? sql`WHERE ${where}` : sql``}
          ORDER BY user_id
          LIMIT ${perPage} OFFSET ${offset}`
    )
    const items = (Array.isArray(rows) ? rows : (rows as unknown as { rows: Record<string, unknown>[] }).rows).map((r) => ({
      userId: String(r.user_id),
      lastLogin: null,
      createdAt: String(r.created_at),
    }))

    return c.json({
      items,
      pagination: { total, page, per_page: perPage, total_pages: totalPages },
    })
  })

  return admin
}

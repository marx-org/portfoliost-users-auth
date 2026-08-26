import { Hono } from "hono"
import { userIdentityMiddleware, requireGroup } from "../auth.js"
import { getDb, type DB } from "../db/index.js"
import { userPreferences } from "../db/schema.js"
import { sql, like, or } from "drizzle-orm"

export function createAdminRoutes(db?: DB) {
  const admin = new Hono()
  admin.use("*", userIdentityMiddleware, requireGroup("portfoliost_admin"))

  admin.get("/list", async (c) => {
    const d = db ?? getDb()
    const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10))
    const perPage = Math.min(200, Math.max(1, parseInt(c.req.query("per_page") ?? "50", 10)))
    const search = c.req.query("search")

    // D48b amendment: identity columns are persisted at token exchange,
    // so this returns the full admin surface payload with no OIDC calls.
    const where = search
      ? or(like(userPreferences.userId, `${search}%`), like(userPreferences.email, `%${search}%`))
      : undefined

    const countResult = await d.execute(
      sql`SELECT COUNT(*) as count FROM users_auth.user_preferences ${where ? sql`WHERE ${where}` : sql``}`
    )
    const countRows = (Array.isArray(countResult) ? countResult : (countResult as unknown as { rows: { count: string }[] }).rows) as { count: string }[]
    const total = parseInt(countRows[0]?.count ?? "0", 10)
    const totalPages = Math.ceil(total / perPage)

    const offset = (page - 1) * perPage
    const rows = await d
      .select({
        userId: userPreferences.userId,
        email: userPreferences.email,
        firstName: userPreferences.firstName,
        lastName: userPreferences.lastName,
        groups: userPreferences.groups,
        lastLogin: userPreferences.lastLogin,
        createdAt: userPreferences.createdAt,
      })
      .from(userPreferences)
      .where(where)
      .orderBy(userPreferences.userId)
      .limit(perPage)
      .offset(offset)

    return c.json({
      items: rows,
      pagination: { total, page, per_page: perPage, total_pages: totalPages },
    })
  })

  return admin
}

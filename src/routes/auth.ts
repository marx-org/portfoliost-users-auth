import { Hono } from "hono"
import { userIdentityMiddleware } from "../auth.js"

export function createAuthRoutes() {
  const router = new Hono()

  // GET /api/auth/me - Get current user info
  router.get("/me", userIdentityMiddleware, async (c) => {
    const identity = c.get("userIdentity")
    return c.json({
      id: identity.id,
      email: identity.email,
      firstName: identity.firstName,
      lastName: identity.lastName,
      groups: identity.groups,
    })
  })

  // POST /api/auth/logout - Client-side logout (just clears session)
  router.post("/logout", async (c) => {
    return c.json({ success: true })
  })

  return router
}

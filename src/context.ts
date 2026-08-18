import { Context, Next } from "hono"

export interface UserIdentity {
  id: string
  email: string
  firstName: string
  lastName: string
  language: string
  createdAt: string
}

declare module "hono" {
  interface ContextVariableMap {
    userIdentity: UserIdentity
  }
}

export async function userIdentityMiddleware(c: Context, next: Next) {
  const id = c.req.header("X-User-Id")
  const email = c.req.header("X-User-Email")
  const firstName = c.req.header("X-User-FirstName") ?? ""
  const lastName = c.req.header("X-User-LastName") ?? ""
  const language = c.req.header("X-User-Language") ?? "en"
  const createdAt = c.req.header("X-User-CreatedAt") ?? new Date().toISOString()

  if (!id || !email) {
    return c.json({ error: "Unauthorized", message: "Missing user identity headers" }, 401)
  }

  c.set("userIdentity", { id, email, firstName, lastName, language, createdAt })
  await next()
}

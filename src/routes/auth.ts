import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { userIdentityMiddleware } from "../auth.js"
import { getDb, type DB } from "../db/index.js"
import { userPreferences } from "../db/schema.js"
import type { components } from "../generated/api-types.js"

type AuthResponse = components["schemas"]["AuthResponse"]
type AuthUser = components["schemas"]["AuthUser"]
type MeResponse = components["schemas"]["MeResponse"]

interface TokenExchangeRequest {
  code: string
  verifier: string
  redirect_uri: string
}

interface PocketIDTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  id_token: string
}

async function exchangeWithPocketID(req: TokenExchangeRequest): Promise<PocketIDTokenResponse> {
  const tokenUrl = process.env.POCKETID_TOKEN_URL
  const clientId = process.env.POCKETID_CLIENT_ID
  const clientSecret = process.env.POCKETID_CLIENT_SECRET

  if (!tokenUrl || !clientId) {
    throw new Error("PocketID not configured")
  }

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: req.code,
    code_verifier: req.verifier,
    redirect_uri: req.redirect_uri,
    client_id: clientId,
  })

  if (clientSecret) {
    params.set("client_secret", clientSecret)
  }

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })

  if (!response.ok) {
    const error = await response.text()
    console.error("PocketID token exchange failed:", response.status, error)
    throw new Error(`Token exchange failed: ${error}`)
  }

  return response.json()
}

async function getOrCreatePreferences(db: DB, userId: string) {
  const now = new Date().toISOString()
  await db
    .insert(userPreferences)
    .values({ userId, createdAt: now, updatedAt: now })
    .onConflictDoNothing()

  const rows = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
  return rows[0]
}

export function createAuthRoutes(db?: DB) {
  const router = new Hono()
  const getDbInstance = () => db ?? getDb()

  // POST /api/auth/token - Exchange OIDC code for tokens
  router.post("/token", async (c) => {
    const body = await c.req.json() as TokenExchangeRequest

    if (!body.code || !body.verifier || !body.redirect_uri) {
      return c.json({ error: "Bad Request", message: "Missing required fields" }, 400)
    }

    try {
      const tokenResponse = await exchangeWithPocketID(body)

      const db = getDbInstance()

      // Decode id_token to extract real user claims
      const idParts = tokenResponse.id_token.split(".")
      const idPayload = JSON.parse(Buffer.from(idParts[1], "base64url").toString())

      const userId = idPayload.sub
      const email = idPayload.email || ""
      const firstName = idPayload.given_name || ""
      const lastName = idPayload.family_name || ""
      // D45/D50 — groups gate the admin surface; PocketID emits string[]
      // under claim "groups" when the "groups" scope is granted.
      const rawGroups = idPayload.groups
      const groups: string[] = Array.isArray(rawGroups)
        ? rawGroups.map((g) => (typeof g === "string" ? g : String((g as { name?: string })?.name ?? g))).filter(Boolean)
        : []

      await getOrCreatePreferences(db, userId)

      const now = new Date().toISOString()
      await db
        .update(userPreferences)
        .set({ lastLogin: now })
        .where(eq(userPreferences.userId, userId))

      return c.json({
        access_token: tokenResponse.id_token,
        token_type: tokenResponse.token_type,
        expires_in: tokenResponse.expires_in,
        user: {
          id: userId,
          email,
          groups,
          language: "en",
          role: "user",
          isDemoUser: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      } satisfies AuthResponse)
    } catch (error) {
      console.error("Token exchange error:", error)
      // If PocketID is not configured, return a mock response for development
      if (process.env.NODE_ENV !== "production") {
        const db = getDbInstance()
        const mockUser = {
          id: "dev-user-id",
          email: "dev@example.com",
          firstName: "Dev",
          lastName: "User",
          groups: ["portfoliost_admin"],
        }

        await getOrCreatePreferences(db, mockUser.id)

        await db
          .update(userPreferences)
          .set({ lastLogin: new Date().toISOString() })
          .where(eq(userPreferences.userId, mockUser.id))

        return c.json({
          access_token: "dev-mock-token-" + Date.now(),
          token_type: "Bearer",
          expires_in: 3600,
          user: {
            id: mockUser.id,
            email: mockUser.email,
            language: "en",
            role: "user",
            isDemoUser: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        } satisfies AuthResponse)
      }

      return c.json({ error: "Unauthorized", message: "Token exchange failed" }, 401)
    }
  })

  // GET /api/auth/me - Get current user info
  router.get("/me", userIdentityMiddleware, async (c) => {
    const identity = c.get("userIdentity")
    return c.json({
      user: {
        id: identity.id,
        email: identity.email,
        groups: identity.groups,
        language: "en",
        role: "user",
        isDemoUser: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } satisfies MeResponse)
  })

  // POST /api/auth/logout - Client-side logout (just clears session)
  router.post("/logout", async (c) => {
    return c.json({ success: true })
  })

  return router
}

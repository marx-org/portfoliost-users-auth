import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { userIdentityMiddleware } from "../auth.js"
import { getDb } from "../db/index.js"
import { userPreferences } from "../db/schema.js"
import type { drizzle } from "drizzle-orm/libsql"

type DB = ReturnType<typeof drizzle>

interface TokenExchangeRequest {
  code: string
  code_verifier: string
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
    code_verifier: req.code_verifier,
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

    if (!body.code || !body.code_verifier || !body.redirect_uri) {
      return c.json({ error: "Bad Request", message: "Missing required fields" }, 400)
    }

    try {
      const tokenResponse = await exchangeWithPocketID(body)

      // For now, we'll use the access_token as the token
      // In a real implementation, we'd validate the JWT and extract claims
      // For now, return a mock user response
      const db = getDbInstance()
      const mockUser = {
        id: "mock-user-id",
        email: "user@example.com",
        firstName: "Mock",
        lastName: "User",
        groups: ["portfoliost_admin"],
      }

      // Upsert user preferences
      await getOrCreatePreferences(db, mockUser.id)

      return c.json({
        access_token: tokenResponse.access_token,
        token_type: tokenResponse.token_type,
        expires_in: tokenResponse.expires_in,
        user: {
          id: mockUser.id,
          email: mockUser.email,
          firstName: mockUser.firstName,
          lastName: mockUser.lastName,
          language: "en",
          role: "user",
          isDemoUser: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      })
    } catch (error) {
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

        return c.json({
          access_token: "dev-mock-token-" + Date.now(),
          token_type: "Bearer",
          expires_in: 3600,
          user: {
            id: mockUser.id,
            email: mockUser.email,
            firstName: mockUser.firstName,
            lastName: mockUser.lastName,
            language: "en",
            role: "user",
            isDemoUser: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        })
      }

      return c.json({ error: "Unauthorized", message: "Token exchange failed" }, 401)
    }
  })

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

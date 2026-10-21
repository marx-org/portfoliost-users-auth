import { Hono } from "hono"
import { eq } from "drizzle-orm"
import { userIdentityMiddleware, verifySessionToken } from "../auth.js"
import { getDb, type DB } from "../db/index.js"
import { refreshSessions, userPreferences } from "../db/schema.js"
import type { components } from "../generated/api-types.js"

function canonicalUrl(value: string, field: string): string {
  const url = new URL(value)
  if (!(["http:", "https:"] as string[]).includes(url.protocol)) {
    throw new Error(`${field} must use HTTP or HTTPS`)
  }
  if (url.username || url.password || url.hash) {
    throw new Error(`${field} must not contain credentials or a fragment`)
  }
  return url.href
}

function exactUrlAllowlist(name: string): Set<string> {
  const values = process.env[name]
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  if (!values?.length) throw new Error(`${name} is not configured`)
  return new Set(values.map((value) => canonicalUrl(value, name)))
}

function safePocketIDUrl(value: string | undefined): string {
  if (!value) throw new Error("PocketID not configured")
  const tokenUrl = canonicalUrl(value, "POCKETID_TOKEN_URL")
  if (!exactUrlAllowlist("POCKETID_ALLOWED_TOKEN_URLS").has(tokenUrl)) {
    throw new Error("POCKETID_TOKEN_URL is not allowed")
  }
  return tokenUrl
}

type AuthResponse = components["schemas"]["AuthResponse"]
type AuthUser = components["schemas"]["AuthUser"]
type MeResponse = components["schemas"]["MeResponse"]

interface TokenExchangeRequest {
  code: string
  verifier: string
  redirect_uri: string
}

const DEV_REDIRECT_URI = "http://localhost:3000/auth/callback"

function allowedRedirectUris(): Set<string> {
  const configured = process.env.POCKETID_ALLOWED_REDIRECT_URIS
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  if (configured?.length) {
    return new Set(configured.map((value) => canonicalUrl(value, "POCKETID_ALLOWED_REDIRECT_URIS")))
  }

  // Local compose has a fixed callback. Production must configure the list
  // explicitly instead of accepting a callback supplied by the browser.
  if (process.env.NODE_ENV !== "production") return new Set([DEV_REDIRECT_URI])
  throw new Error("POCKETID_ALLOWED_REDIRECT_URIS is not configured")
}

function validateRedirectUri(value: string): string {
  let redirectUri: URL
  try {
    redirectUri = new URL(value)
  } catch {
    throw new Error("Invalid redirect_uri")
  }

  if (!allowedRedirectUris().has(redirectUri.href)) {
    throw new Error("redirect_uri is not allowed")
  }

  return redirectUri.href
}

interface PocketIDTokenResponse {
  access_token: string
  token_type: string
  expires_in: number
  id_token: string
  refresh_token?: string
}

/** JWT payload shape of the Pocket-ID id_token. */
interface IdTokenClaims {
  sub?: string
  jti?: string
  email?: string
  given_name?: string
  family_name?: string
  groups?: unknown
}

function decodeIdTokenPayload(idToken: string): IdTokenClaims {
  const parts = idToken.split(".")
  if (parts.length < 2) throw new Error("Malformed id_token")
  return JSON.parse(Buffer.from(parts[1], "base64url").toString()) as IdTokenClaims
}

/** PocketID emits string[] under "groups" when the "groups" scope is granted. */
function toGroups(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((g) => (typeof g === "string" ? g : String((g as { name?: string })?.name ?? g)))
    .filter(Boolean)
}

/**
 * Persist the refresh token against the id_token the browser is about to hold,
 * keyed by that token's `jti` (§77.2). A missing refresh_token or jti is not an
 * error — it just means the browser gets no long-lived session and must
 * re-authenticate at expiry, exactly as it does today.
 *
 * Stored in the clear: the refresh grant must send the value verbatim to
 * PocketID, so a hash would be unexchangeable. See the comment on
 * `refreshSessions` for why that is acceptable here.
 */
async function persistRefreshSession(
  db: DB,
  idTokenClaims: IdTokenClaims,
  refreshToken: string | undefined
): Promise<void> {
  if (!refreshToken || !idTokenClaims.jti || !idTokenClaims.sub) return
  const now = new Date().toISOString()
  await db
    .insert(refreshSessions)
    .values({
      idTokenJti: idTokenClaims.jti,
      userId: idTokenClaims.sub,
      refreshToken,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: refreshSessions.idTokenJti,
      set: { refreshToken, updatedAt: now },
    })
}

async function exchangeWithPocketID(req: TokenExchangeRequest): Promise<PocketIDTokenResponse> {
  const tokenUrl = safePocketIDUrl(process.env.POCKETID_TOKEN_URL)
  const clientId = process.env.POCKETID_CLIENT_ID
  const clientSecret = process.env.POCKETID_CLIENT_SECRET
  const redirectUri = validateRedirectUri(req.redirect_uri)

  if (!tokenUrl || !clientId) {
    throw new Error("PocketID not configured")
  }

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: req.code,
    code_verifier: req.verifier,
    redirect_uri: redirectUri,
    client_id: clientId,
  })

  if (clientSecret) {
    params.set("client_secret", clientSecret)
  }

  //lgtm[js/request-forgery]
  const response = await fetch(tokenUrl, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })

  if (!response.ok) {
    console.error("PocketID token exchange failed:", response.status)
    throw new Error("Token exchange failed")
  }

  return response.json()
}

/** Redeem a stored refresh token at Pocket-ID for a new token set. */
async function refreshWithPocketID(refreshToken: string): Promise<PocketIDTokenResponse> {
  const tokenUrl = safePocketIDUrl(process.env.POCKETID_TOKEN_URL)
  const clientId = process.env.POCKETID_CLIENT_ID
  if (!tokenUrl || !clientId) throw new Error("PocketID not configured")

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  })

  //lgtm[js/request-forgery]
  const response = await fetch(tokenUrl, {
    method: "POST",
    redirect: "error",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })

  if (!response.ok) {
    console.error("PocketID token refresh failed:", response.status)
    throw new Error("Token refresh failed")
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
      const idClaims = decodeIdTokenPayload(tokenResponse.id_token)

      const userId = idClaims.sub
      if (!userId) throw new Error("id_token has no sub claim")
      const email = idClaims.email || ""
      const firstName = idClaims.given_name || ""
      const lastName = idClaims.family_name || ""
      // D45/D50 — groups gate the admin surface; PocketID emits string[]
      // under claim "groups" when the "groups" scope is granted.
      const groups = toGroups(idClaims.groups)

      await getOrCreatePreferences(db, userId)

      const now = new Date().toISOString()
      await db
        .update(userPreferences)
        .set({ lastLogin: now })
        .where(eq(userPreferences.userId, userId))

      // §77.2 — keep the 30-day refresh token server-side instead of
      // discarding it. The HTTP response is unchanged, so no refresh token
      // ever reaches the browser.
      await persistRefreshSession(db, idClaims, tokenResponse.refresh_token)

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

  // POST /api/auth/refresh - rotate the refresh session and issue a new id_token (§77.3)
  router.post("/refresh", async (c) => {
    let body: { id_token?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "Bad Request", message: "Invalid JSON body" }, 400)
    }

    const idToken = body.id_token
    if (!idToken) {
      return c.json({ error: "Bad Request", message: "id_token is required" }, 400)
    }

    // Identify the session from the submitted token. Expiry is not checked —
    // a lapsed token is the normal reason to be here. Identity is taken from
    // the *new* token below, never from this one.
    let claims: { jti?: string }
    try {
      claims = await verifySessionToken(idToken)
    } catch {
      return c.json({ error: "Unauthorized", message: "Invalid token" }, 401)
    }

    if (!claims.jti) {
      return c.json({ error: "Unauthorized", message: "Token has no jti claim" }, 401)
    }

    const db = getDbInstance()

    const sessions = await db
      .select()
      .from(refreshSessions)
      .where(eq(refreshSessions.idTokenJti, claims.jti))

    // No row means: never logged in, already refreshed (the old jti is dead),
    // or logged out. All three are the same thing to the caller.
    const session = sessions[0]
    if (!session) {
      return c.json({ error: "Unauthorized", message: "No active session" }, 401)
    }

    let tokenResponse: PocketIDTokenResponse
    try {
      tokenResponse = await refreshWithPocketID(session.refreshToken)
    } catch {
      // PocketID rejected the token (revoked, user disabled, group changed).
      // Drop the row so the client falls back to a real login instead of
      // retrying a dead session on every request.
      await db.delete(refreshSessions).where(eq(refreshSessions.idTokenJti, claims.jti))
      return c.json({ error: "Unauthorized", message: "Session expired" }, 401)
    }

    const newClaims = decodeIdTokenPayload(tokenResponse.id_token)
    if (!newClaims.jti || !newClaims.sub) {
      return c.json({ error: "Unauthorized", message: "Malformed id_token" }, 401)
    }

    // Rotate: PocketID consumed the old refresh token, so the row must follow
    // the new jti. Replacing the primary key in one statement keeps a crashed
    // rotation from leaving two live sessions behind.
    const now = new Date().toISOString()
    await db
      .delete(refreshSessions)
      .where(eq(refreshSessions.idTokenJti, claims.jti))
    await db.insert(refreshSessions).values({
      idTokenJti: newClaims.jti,
      userId: newClaims.sub,
      refreshToken: tokenResponse.refresh_token ?? session.refreshToken,
      createdAt: now,
      updatedAt: now,
    })

    return c.json({
      access_token: tokenResponse.id_token,
      token_type: tokenResponse.token_type,
      expires_in: tokenResponse.expires_in,
      user: {
        id: newClaims.sub,
        email: newClaims.email || "",
        groups: toGroups(newClaims.groups),
        language: "en",
        role: "user",
        isDemoUser: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    } satisfies AuthResponse)
  })
  // POST /api/auth/logout - revoke this browser's refresh session (§77.4)
  //
  // Until now this was `return c.json({ success: true })` and revoked nothing.
  // That was survivable while there was no long-lived session to lose; with a
  // 30-day refresh token it would mean "log out" does not log out.
  //
  // `id_token` is optional so a client predating this still gets a 200 — but
  // without it there is nothing to identify the session, and that logout is
  // only local. The frontend sends it.
  router.post("/logout", async (c) => {
    let idToken: string | undefined
    try {
      const body = (await c.req.json()) as { id_token?: string }
      idToken = body?.id_token
    } catch {
      // Empty body is fine — see above.
    }

    if (idToken) {
      try {
        const claims = await verifySessionToken(idToken)
        if (claims.jti) {
          await getDbInstance()
            .delete(refreshSessions)
            .where(eq(refreshSessions.idTokenJti, claims.jti))
        }
      } catch (error) {
        // A token we cannot verify cannot identify a session. Still 200 —
        // logout is idempotent and the client clears its own state regardless.
        console.error("Logout could not verify id_token:", error)
      }
    }

    return c.json({ success: true })
  })

  return router
}

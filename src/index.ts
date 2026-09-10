import { Hono } from "hono"
import { pino } from "pino"
import { createUsersRoutes } from "./routes/users.js"
import { createAuthRoutes } from "./routes/auth.js"
import { createAdminRoutes } from "./routes/admin.js"
import { createDoc } from "./doc.js"
import { validateJwt } from "./auth.js"
import { moduleMeta } from "./meta.js"
import { metricsRouteHandler } from "./instrumentation.js"

const app = new Hono()

const log = pino({ base: { service: "portfoliost-users-auth" } })
app.use("*", async (c, next) => {
  const start = Date.now()
  await next()
  log.info({
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration_ms: Date.now() - start,
    request_id: c.req.header("x-request-id") ?? undefined,
  })
})

app.get("/metrics", metricsRouteHandler)

app.get("/health", (c) => c.json({ status: "ok" }))

// D4 — module identity/verification endpoint
app.get("/__meta", (c) => c.json(moduleMeta()))

// D9 — edge auth preflight: 204 when the bearer token validates, 401 otherwise
app.get("/internal/verify", validateJwt, (c) => c.body(null, 204))

const api = new Hono()
api.route("/auth", createAuthRoutes())
api.route("/users", createUsersRoutes())
// D48 — admin-facing users list endpoint
api.route("/users/admin", createAdminRoutes())

const doc = createDoc(api)

app.get("/api/doc", (c) => c.json(doc))
app.route("/api", api)

export default app

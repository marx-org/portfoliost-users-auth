import { Hono } from "hono"
import { logger } from "hono/logger"
import { createUsersRoutes } from "./routes/users.js"
import { createAuthRoutes } from "./routes/auth.js"
import { createDoc } from "./doc.js"

const app = new Hono()

app.use("*", logger())

app.get("/health", (c) => c.json({ status: "ok" }))

const api = new Hono()
api.route("/auth", createAuthRoutes())
api.route("/users", createUsersRoutes())

const doc = createDoc(api)

app.get("/api/doc", (c) => c.json(doc))
app.route("/api", api)

export default app

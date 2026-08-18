import { Hono } from "hono"
import { logger } from "hono/logger"
import { createUsersRoutes } from "./routes/users.js"

const app = new Hono()

app.use("*", logger())

app.get("/health", (c) => c.json({ status: "ok" }))
app.route("/api/users", createUsersRoutes())

export default app

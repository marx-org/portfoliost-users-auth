import { seed } from "../dist/db/seed.js"
import { dirname, resolve } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbUrl =
  process.env.DATABASE_URL ||
  "postgres://portfoliost:portfoliost@localhost:5432/portfoliost"
const seedDir = resolve(__dirname)

seed(dbUrl, seedDir).catch((err) => {
  console.error("Seed failed:", err)
  process.exit(1)
})

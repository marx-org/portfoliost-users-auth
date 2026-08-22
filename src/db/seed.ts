import postgres from "postgres"
import { readdir, readFile } from "fs/promises"
import { join } from "path"

export async function seed(dbUrl: string, seedDir: string) {
  const sql = postgres(dbUrl, { max: 1 })

  try {
    const rows = await sql`SELECT COUNT(*)::int AS count FROM users_auth.user_preferences`
    if (rows[0].count > 0) {
      console.log(`users_auth.user_preferences has ${rows[0].count} row(s), skipping seed`)
      return false
    }

    console.log("users_auth.user_preferences is empty, running seed...")

    const files = (await readdir(seedDir)).filter((f) => f.endsWith(".sql")).sort()
    for (const file of files) {
      const content = await readFile(join(seedDir, file), "utf-8")
      await sql.unsafe(content)
      console.log(`  Seeded: ${file}`)
    }

    console.log("Seed complete")
    return true
  } finally {
    await sql.end()
  }
}

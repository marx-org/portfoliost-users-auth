import { createClient } from "@libsql/client"
import { readdir, readFile } from "fs/promises"
import { join } from "path"

export async function seed(dbUrl: string, seedDir: string) {
  const client = createClient({ url: dbUrl })

  const result = await client.execute("SELECT COUNT(*) as count FROM user_preferences")
  const rowCount = Number(result.rows[0].count)
  if (rowCount > 0) {
    console.log(`user_preferences has ${rowCount} row(s), skipping seed`)
    return false
  }

  console.log("user_preferences is empty, running seed...")

  const files = (await readdir(seedDir)).filter((f) => f.endsWith(".sql")).sort()
  for (const file of files) {
    const sql = await readFile(join(seedDir, file), "utf-8")
    await client.executeMultiple(sql)
    console.log(`  Seeded: ${file}`)
  }

  console.log("Seed complete")
  return true
}

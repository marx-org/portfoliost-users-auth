import { createClient, type Client } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import * as schema from "./schema.js"

let _client: Client | null = null
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb() {
  if (!_db) {
    _client = createClient({ url: "file:data/portfoliost.db" })
    _db = drizzle(_client, { schema })
  }
  return _db
}

export function createTestDb() {
  const client = createClient({ url: ":memory:" })
  const db = drizzle(client, { schema })
  return { db, client }
}

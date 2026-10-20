import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { authSchema } from './schema.js'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to initialize PostgreSQL.')
}

export const pool = new Pool({ connectionString: databaseUrl })
export const db = drizzle(pool, { schema: authSchema })

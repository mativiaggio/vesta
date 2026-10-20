import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../../../../packages/database/src/client.js'
import { workspaceMutationRateLimit } from '../../../../packages/database/src/schema.js'
import type { MutationRateLimiter, MutationRateLimitPolicy } from './mutation-rate-limiter.js'

export class PostgresMutationRateLimiter implements MutationRateLimiter {
  async consume(scopeKey: string, policies: readonly MutationRateLimitPolicy[]) {
    if (policies.length === 0) return { allowed: true, retryAfterSeconds: 0 }

    return db.transaction(async (transaction) => {
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`workspace-rate-limit:${scopeKey}`}))`)
      const clockResult = await transaction.execute<{ now: Date | string }>(sql`select clock_timestamp() as now`)
      const databaseNow = clockResult.rows[0]?.now
      const now = databaseNow instanceof Date ? databaseNow : new Date(databaseNow ?? Number.NaN)
      if (Number.isNaN(now.getTime())) throw new Error('Database clock was unavailable.')

      const keys = policies.map((policy) => `${scopeKey}:${policy.suffix}`)
      const currentRows = await transaction
        .select({
          id: workspaceMutationRateLimit.id,
          key: workspaceMutationRateLimit.key,
          count: workspaceMutationRateLimit.count,
          windowStartedAt: workspaceMutationRateLimit.windowStartedAt,
        })
        .from(workspaceMutationRateLimit)
        .where(and(inArray(workspaceMutationRateLimit.key, keys), isNull(workspaceMutationRateLimit.deletedAt)))
        .for('update')

      const currentByKey = new Map(currentRows.map((row) => [row.key, row]))
      let retryAfterSeconds = 0

      for (const policy of policies) {
        const current = currentByKey.get(`${scopeKey}:${policy.suffix}`)
        if (!current) continue

        const elapsed = now.getTime() - current.windowStartedAt.getTime()
        if (elapsed < policy.windowMs && current.count >= policy.max) {
          retryAfterSeconds = Math.max(retryAfterSeconds, Math.max(1, Math.ceil((policy.windowMs - elapsed) / 1000)))
        }
      }

      if (retryAfterSeconds > 0) return { allowed: false, retryAfterSeconds }

      for (const policy of policies) {
        const key = `${scopeKey}:${policy.suffix}`
        const current = currentByKey.get(key)
        const elapsed = current ? now.getTime() - current.windowStartedAt.getTime() : policy.windowMs
        const windowStartedAt = !current || elapsed >= policy.windowMs ? now : current.windowStartedAt
        const expiresAt = new Date(windowStartedAt.getTime() + policy.windowMs)

        if (!current) {
          await transaction.insert(workspaceMutationRateLimit).values({
            id: randomUUID(),
            key,
            count: 1,
            windowStartedAt,
            expiresAt,
            createdAt: now,
            updatedAt: now,
          })
          continue
        }

        await transaction
          .update(workspaceMutationRateLimit)
          .set({
            count: elapsed >= policy.windowMs ? 1 : current.count + 1,
            windowStartedAt,
            expiresAt,
            updatedAt: now,
          })
          .where(and(eq(workspaceMutationRateLimit.id, current.id), isNull(workspaceMutationRateLimit.deletedAt)))
      }

      return { allowed: true, retryAfterSeconds: 0 }
    })
  }
}

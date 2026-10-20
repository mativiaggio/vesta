import { and, asc, inArray, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../../../../packages/database/src/client.js'
import { syncMutationReceipt, workspaceMutationRateLimit } from '../../../../packages/database/src/schema.js'

export const syncReceiptRetentionDays = 30
export const retentionBatchSize = 500
export const retentionMaxBatchesPerRun = 10

export const retentionMaintenanceLockName = 'vesta:retention-maintenance'
const idleIntervalMs = 60 * 60 * 1000
const backlogIntervalMs = 5 * 1000
const initialRetryIntervalMs = 60 * 1000
const maximumRetryIntervalMs = 60 * 60 * 1000

export type RetentionMaintenanceResult = {
  acquired: boolean
  purgedReceipts: number
  purgedRateLimits: number
  hasMore: boolean
}

export function mutationReceiptExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + syncReceiptRetentionDays * 24 * 60 * 60 * 1000)
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type RetentionTable = typeof syncMutationReceipt | typeof workspaceMutationRateLimit

async function purgeExpiredRows(
  transaction: Transaction,
  table: RetentionTable,
  now: Date,
  batchSize: number,
  maxBatches: number,
): Promise<{ purged: number; hasMore: boolean }> {
  let purged = 0

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const rows = await transaction
      .select({ id: table.id })
      .from(table)
      .where(and(lt(table.expiresAt, now), isNull(table.deletedAt)))
      .orderBy(asc(table.expiresAt), asc(table.id))
      .limit(batchSize)
      .for('update', { skipLocked: true })

    if (rows.length === 0) return { purged, hasMore: false }

    await transaction.delete(table).where(
      inArray(
        table.id,
        rows.map((row) => row.id),
      ),
    )
    purged += rows.length

    if (rows.length < batchSize) return { purged, hasMore: false }
  }

  return { purged, hasMore: true }
}

export async function runRetentionMaintenance(
  options: { now?: Date; batchSize?: number; maxBatches?: number } = {},
): Promise<RetentionMaintenanceResult> {
  const batchSize = options.batchSize ?? retentionBatchSize
  const maxBatches = options.maxBatches ?? retentionMaxBatchesPerRun
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error('Retention batch size must be positive.')
  if (!Number.isSafeInteger(maxBatches) || maxBatches < 1)
    throw new Error('Retention maximum batches must be positive.')

  return db.transaction(async (transaction) => {
    const lockResult = await transaction.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext(${retentionMaintenanceLockName})) as acquired`,
    )
    if (!lockResult.rows[0]?.acquired) {
      return { acquired: false, purgedReceipts: 0, purgedRateLimits: 0, hasMore: false }
    }

    const clockResult = options.now
      ? undefined
      : await transaction.execute<{ now: Date | string }>(sql`select clock_timestamp() as now`)
    const databaseNow = clockResult?.rows[0]?.now
    const now = options.now ?? (databaseNow instanceof Date ? databaseNow : new Date(databaseNow ?? Number.NaN))
    if (Number.isNaN(now.getTime())) throw new Error('Database clock was unavailable.')

    const receipts = await purgeExpiredRows(transaction, syncMutationReceipt, now, batchSize, maxBatches)
    const rateLimits = await purgeExpiredRows(transaction, workspaceMutationRateLimit, now, batchSize, maxBatches)

    return {
      acquired: true,
      purgedReceipts: receipts.purged,
      purgedRateLimits: rateLimits.purged,
      hasMore: receipts.hasMore || rateLimits.hasMore,
    }
  })
}

function withJitter(intervalMs: number): number {
  return Math.round(intervalMs * (0.9 + Math.random() * 0.2))
}

export function startSyncReceiptRetention(): () => void {
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  let retryIntervalMs = initialRetryIntervalMs

  const schedule = (intervalMs: number) => {
    if (stopped) return
    timer = setTimeout(() => void run(), withJitter(intervalMs))
    timer.unref()
  }

  const run = async () => {
    try {
      const result = await runRetentionMaintenance()
      retryIntervalMs = initialRetryIntervalMs
      if (result.purgedReceipts > 0 || result.purgedRateLimits > 0) {
        process.stdout.write(
          `[maintenance] Purged ${result.purgedReceipts} sync receipts and ${result.purgedRateLimits} workspace rate-limit rows.\n`,
        )
      }
      schedule(result.hasMore ? backlogIntervalMs : idleIntervalMs)
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError'
      process.stderr.write(
        `[maintenance] Retention failed (${errorName}); retrying in ${Math.round(retryIntervalMs / 1000)} seconds.\n`,
      )
      schedule(retryIntervalMs)
      retryIntervalMs = Math.min(retryIntervalMs * 2, maximumRetryIntervalMs)
    }
  }

  void run()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}

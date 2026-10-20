import { describe, expect, it } from 'vitest'
import {
  mutationReceiptExpiry,
  retentionBatchSize,
  retentionMaxBatchesPerRun,
  syncReceiptRetentionDays,
} from './sync-receipt-retention.js'

describe('sync mutation receipt retention', () => {
  it('keeps idempotency receipts for the documented retry window', () => {
    const createdAt = new Date('2026-10-20T00:00:00.000Z')
    expect(mutationReceiptExpiry(createdAt).toISOString()).toBe('2026-11-19T00:00:00.000Z')
    expect(syncReceiptRetentionDays).toBe(30)
    expect(retentionBatchSize * retentionMaxBatchesPerRun).toBe(5_000)
  })
})

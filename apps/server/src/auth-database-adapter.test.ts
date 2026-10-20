import type { DBTransactionAdapter } from 'better-auth/adapters'
import { describe, expect, it, vi } from 'vitest'
import {
  authModelUsesPhysicalDeletion,
  deleteAuthRecord,
  deleteManyAuthRecords,
  withModelActiveRecord,
} from './auth-database-adapter.js'

describe('auth database deletion policy', () => {
  it('physically deletes only ephemeral Better Auth rate-limit records', () => {
    expect(authModelUsesPhysicalDeletion('rateLimit')).toBe(true)
    expect(authModelUsesPhysicalDeletion('user')).toBe(false)
    expect(authModelUsesPhysicalDeletion('session')).toBe(false)
    expect(authModelUsesPhysicalDeletion('account')).toBe(false)
    expect(authModelUsesPhysicalDeletion('verification')).toBe(false)
  })

  it('does not inject the application-only deletedAt field into Better Auth rate-limit queries', () => {
    const where = [{ field: 'key', value: 'sign-in:client' }]

    expect(withModelActiveRecord('rateLimit', where)).toBe(where)
    expect(withModelActiveRecord('user', where)).toEqual([...where, { field: 'deletedAt', value: null }])
    expect(withModelActiveRecord('rateLimit', undefined)).toBeUndefined()
  })

  it('delegates rate-limit cleanup to physical deletion', async () => {
    const deleteOne = vi.fn<DBTransactionAdapter['delete']>().mockResolvedValue(undefined)
    let updateCount = 0
    const updateOne: DBTransactionAdapter['update'] = <T>() => {
      updateCount += 1
      return Promise.resolve<T | null>(null)
    }
    const deleteMany = vi.fn<DBTransactionAdapter['deleteMany']>().mockResolvedValue(3)
    const updateMany = vi.fn<DBTransactionAdapter['updateMany']>().mockResolvedValue(0)
    const where = [{ field: 'key', value: 'expired' }]

    await deleteAuthRecord({ delete: deleteOne, update: updateOne }, { model: 'rateLimit', where })
    const deleted = await deleteManyAuthRecords({ deleteMany, updateMany }, { model: 'rateLimit', where })

    expect(deleteOne).toHaveBeenCalledWith({ model: 'rateLimit', where })
    expect(deleteMany).toHaveBeenCalledWith({ model: 'rateLimit', where })
    expect(updateCount).toBe(0)
    expect(updateMany).not.toHaveBeenCalled()
    expect(deleted).toBe(3)
  })

  it('keeps domain authentication records on the soft-delete path', async () => {
    const now = new Date('2026-10-20T00:00:00.000Z')
    const deleteMany = vi.fn<DBTransactionAdapter['deleteMany']>().mockResolvedValue(0)
    const updateMany = vi.fn<DBTransactionAdapter['updateMany']>().mockResolvedValue(2)

    const deleted = await deleteManyAuthRecords(
      { deleteMany, updateMany },
      { model: 'session', where: [{ field: 'userId', value: 'user-1' }] },
      now,
    )

    expect(deleteMany).not.toHaveBeenCalled()
    expect(updateMany).toHaveBeenCalledWith({
      model: 'session',
      where: [
        { field: 'userId', value: 'user-1' },
        { field: 'deletedAt', value: null },
      ],
      update: { deletedAt: now, updatedAt: now },
    })
    expect(deleted).toBe(2)
  })
})

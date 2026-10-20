import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { DBAdapter, DBTransactionAdapter, Where } from 'better-auth/adapters'
import { db } from '../../../packages/database/src/client.js'

const drizzleFactory = drizzleAdapter(db, { provider: 'pg', transaction: true })
const activeRecord = { field: 'deletedAt', value: null } satisfies Where

function withActiveRecord(where: Where[] | undefined): Where[] {
  return [...(where ?? []), activeRecord]
}

export function authModelUsesPhysicalDeletion(model: string): boolean {
  return model === 'rateLimit'
}

export function withModelActiveRecord(model: string, where: Where[] | undefined): Where[] | undefined {
  return authModelUsesPhysicalDeletion(model) ? where : withActiveRecord(where)
}

type SingleDeleteAdapter = Pick<DBTransactionAdapter, 'delete' | 'update'>
type BulkDeleteAdapter = Pick<DBTransactionAdapter, 'deleteMany' | 'updateMany'>

export async function deleteAuthRecord(
  adapter: SingleDeleteAdapter,
  data: Parameters<DBTransactionAdapter['delete']>[0],
  deletedAt = new Date(),
): Promise<void> {
  if (authModelUsesPhysicalDeletion(data.model)) {
    await adapter.delete(data)
    return
  }
  await adapter.update({
    model: data.model,
    where: withActiveRecord(data.where),
    update: { deletedAt, updatedAt: deletedAt },
  })
}

export function deleteManyAuthRecords(
  adapter: BulkDeleteAdapter,
  data: Parameters<DBTransactionAdapter['deleteMany']>[0],
  deletedAt = new Date(),
): Promise<number> {
  if (authModelUsesPhysicalDeletion(data.model)) return adapter.deleteMany(data)
  return adapter.updateMany({
    model: data.model,
    where: withActiveRecord(data.where),
    update: { deletedAt, updatedAt: deletedAt },
  })
}

export function withSoftDeletes(adapter: DBTransactionAdapter): DBTransactionAdapter {
  return {
    ...adapter,
    findOne: <T>(data: Parameters<DBTransactionAdapter['findOne']>[0]) =>
      adapter.findOne<T>({ ...data, where: withModelActiveRecord(data.model, data.where) ?? [] }),
    findMany: <T>(data: Parameters<DBTransactionAdapter['findMany']>[0]) =>
      adapter.findMany<T>({ ...data, where: withModelActiveRecord(data.model, data.where) }),
    count: (data: Parameters<DBTransactionAdapter['count']>[0]) =>
      adapter.count({ ...data, where: withModelActiveRecord(data.model, data.where) }),
    update: <T>(data: Parameters<DBTransactionAdapter['update']>[0]) =>
      adapter.update<T>({ ...data, where: withModelActiveRecord(data.model, data.where) ?? [] }),
    updateMany: (data: Parameters<DBTransactionAdapter['updateMany']>[0]) =>
      adapter.updateMany({ ...data, where: withModelActiveRecord(data.model, data.where) ?? [] }),
    incrementOne: <T>(data: Parameters<DBTransactionAdapter['incrementOne']>[0]) =>
      adapter.incrementOne<T>({ ...data, where: withModelActiveRecord(data.model, data.where) ?? [] }),
    delete: (data: Parameters<DBTransactionAdapter['delete']>[0]) => deleteAuthRecord(adapter, data),
    deleteMany: (data: Parameters<DBTransactionAdapter['deleteMany']>[0]) => deleteManyAuthRecords(adapter, data),
    consumeOne: async <T>(data: Parameters<DBTransactionAdapter['consumeOne']>[0]) => {
      const activeWhere = withModelActiveRecord(data.model, data.where) ?? []
      const [row] = await adapter.findMany<T>({ ...data, where: activeWhere, limit: 1 })
      if (!row || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'string') return null

      if (authModelUsesPhysicalDeletion(data.model)) {
        await adapter.delete({ model: data.model, where: [...activeWhere, { field: 'id', value: row.id }] })
        return row
      }

      return adapter.update<T>({
        model: data.model,
        where: [...activeWhere, { field: 'id', value: row.id }],
        update: { deletedAt: new Date(), updatedAt: new Date() },
      })
    },
  }
}

export function createAuthDatabaseAdapter(options: Parameters<typeof drizzleFactory>[0]): DBAdapter {
  const adapter = drizzleFactory(options)

  return {
    ...withSoftDeletes(adapter),
    transaction: (callback) => adapter.transaction((transaction) => callback(withSoftDeletes(transaction))),
  }
}

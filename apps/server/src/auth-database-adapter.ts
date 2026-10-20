import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import type { DBAdapter, DBTransactionAdapter, Where } from 'better-auth/adapters'
import { db } from '../../../packages/database/src/client.js'

const drizzleFactory = drizzleAdapter(db, { provider: 'pg', transaction: true })
const activeRecord = { field: 'deletedAt', value: null } satisfies Where

function withActiveRecord(where: Where[] | undefined): Where[] {
  return [...(where ?? []), activeRecord]
}

function withSoftDeletes(adapter: DBTransactionAdapter): DBTransactionAdapter {
  return {
    ...adapter,
    findOne: <T>(data: Parameters<DBTransactionAdapter['findOne']>[0]) =>
      adapter.findOne<T>({ ...data, where: withActiveRecord(data.where) }),
    findMany: <T>(data: Parameters<DBTransactionAdapter['findMany']>[0]) =>
      adapter.findMany<T>({ ...data, where: withActiveRecord(data.where) }),
    count: (data: Parameters<DBTransactionAdapter['count']>[0]) =>
      adapter.count({ ...data, where: withActiveRecord(data.where) }),
    update: <T>(data: Parameters<DBTransactionAdapter['update']>[0]) =>
      adapter.update<T>({ ...data, where: withActiveRecord(data.where) }),
    updateMany: (data: Parameters<DBTransactionAdapter['updateMany']>[0]) =>
      adapter.updateMany({ ...data, where: withActiveRecord(data.where) }),
    delete: async (data: Parameters<DBTransactionAdapter['delete']>[0]) => {
      await adapter.update({
        model: data.model,
        where: withActiveRecord(data.where),
        update: { deletedAt: new Date(), updatedAt: new Date() },
      })
    },
    deleteMany: (data: Parameters<DBTransactionAdapter['deleteMany']>[0]) =>
      adapter.updateMany({
        model: data.model,
        where: withActiveRecord(data.where),
        update: { deletedAt: new Date(), updatedAt: new Date() },
      }),
    consumeOne: async <T>(data: Parameters<DBTransactionAdapter['consumeOne']>[0]) => {
      const [row] = await adapter.findMany<T>({ ...data, where: withActiveRecord(data.where), limit: 1 })
      if (!row || typeof row !== 'object' || !('id' in row) || typeof row.id !== 'string') return null

      return adapter.update<T>({
        model: data.model,
        where: [...withActiveRecord(data.where), { field: 'id', value: row.id }],
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

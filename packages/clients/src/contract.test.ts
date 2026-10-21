import { describe, expect, it } from 'vitest'
import { createClientMutationSchema, deleteClientMutationSchema, updateClientMutationSchema } from './contract'

describe('client contract', () => {
  it('trims and validates the client fields while excluding ownership and audit input', () => {
    const parsed = createClientMutationSchema.parse({
      id: '9fcd84af-2f30-4cf8-8c57-ae181b4b4e09',
      clientMutationId: 'c54a1836-ae43-47ec-af50-1b64c2c4c55e',
      code: '  V-001  ',
      name: '  Example Studio  ',
      active: true,
      workspaceId: 'a4ec805b-ab95-4a31-8107-e6c805ca11fd',
      createdByUserId: 'attacker',
      deletedAt: '2026-10-21T12:00:00.000Z',
    })

    expect(parsed).toEqual({
      id: '9fcd84af-2f30-4cf8-8c57-ae181b4b4e09',
      clientMutationId: 'c54a1836-ae43-47ec-af50-1b64c2c4c55e',
      code: 'V-001',
      name: 'Example Studio',
      active: true,
    })
  })

  it('requires a versioned non-empty patch and versioned logical deletion', () => {
    expect(
      updateClientMutationSchema.safeParse({
        expectedVersion: 1,
        clientMutationId: 'c54a1836-ae43-47ec-af50-1b64c2c4c55e',
      }).success,
    ).toBe(false)
    expect(
      deleteClientMutationSchema.safeParse({
        expectedVersion: 1,
        clientMutationId: 'c54a1836-ae43-47ec-af50-1b64c2c4c55e',
      }).success,
    ).toBe(true)
  })
})

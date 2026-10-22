import { describe, expect, it } from 'vitest'
import { createNoteMutationSchema, noteSchema, richTextDocumentSchema, updateNoteMutationSchema } from './contract'

const ticketId = '2d20306a-22ee-4b2c-83bd-593f0a82cc09'

describe('note contracts', () => {
  it('accepts formatted text with nested lists and safe links', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Decision',
              marks: [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }],
            },
            {
              type: 'text',
              text: ' reference',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.com/reference',
                    target: '_blank',
                    rel: 'noopener noreferrer nofollow',
                    class: null,
                    title: null,
                  },
                },
              ],
            },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 1, type: null },
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
                {
                  type: 'bulletList',
                  content: [
                    { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Nested' }] }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }

    expect(richTextDocumentSchema.parse(content)).toEqual(content)
  })

  it('rejects unsafe links and unsupported editor fields', () => {
    const unsafeLink = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'open', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }],
        },
      ],
    }
    const unexpectedNode = { type: 'doc', content: [{ type: 'paragraph', attrs: { onclick: 'run()' } }] }

    expect(richTextDocumentSchema.safeParse(unsafeLink).success).toBe(false)
    expect(richTextDocumentSchema.safeParse(unexpectedNode).success).toBe(false)
  })

  it('requires a ticket and mutation ID while preserving ticket context in note rows', () => {
    const created = createNoteMutationSchema.parse({
      id: '52c765ed-e9a2-40de-9059-b44500a05ec0',
      clientMutationId: 'dfca6609-0a8e-45ad-9d77-dfa9dbeebad3',
      ticketId,
      title: 'Delivery decision',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    })

    expect(created.ticketId).toBe(ticketId)
    expect(createNoteMutationSchema.safeParse({ ...created, ticketId: 'invalid' }).success).toBe(false)
    expect(
      updateNoteMutationSchema.safeParse({ expectedVersion: 1, clientMutationId: created.clientMutationId }).success,
    ).toBe(false)
    expect(
      noteSchema.parse({
        ...created,
        workspaceId: '7f59d515-47e2-4cfb-9ccb-99822d36d7a4',
        version: 1,
        createdAt: '2026-10-22T00:00:00.000Z',
        updatedAt: '2026-10-22T00:00:00.000Z',
        deletedAt: null,
        createdByUserId: 'user-1',
        updatedByUserId: 'user-1',
        deletedByUserId: null,
        ticket: {
          otNumber: 24,
          title: 'Prepare delivery',
          status: 'review',
          clientId: null,
          clientName: null,
        },
      }).ticket,
    ).toMatchObject({ otNumber: 24, status: 'review', clientId: null })
  })
})

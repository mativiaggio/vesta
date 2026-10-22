import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FilesystemBlobStorage } from './filesystem-blob-storage.js'

describe('filesystem attachment storage', () => {
  let root = ''
  let storage: FilesystemBlobStorage

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'vesta-attachments-'))
    storage = new FilesystemBlobStorage(path.join(root, 'blobs'))
    await storage.initialize()
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('streams, reads, and removes file content without storing it in the database', async () => {
    const id = randomUUID()
    const key = `${id.slice(0, 2)}/${id}.txt`
    const content = Buffer.from('ticket attachment')
    await storage.put(key, Readable.from([content]), content.byteLength, 'text/plain')

    const saved = await readFile(path.join(root, 'blobs', key))
    expect(saved).toEqual(content)
    const stream = await storage.open(key)
    expect(stream).toBeInstanceOf(Readable)
    const chunks: Uint8Array[] = []
    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk)) throw new Error('Attachment stream returned a non-buffer chunk.')
      chunks.push(chunk)
    }
    expect(Buffer.concat(chunks)).toEqual(content)

    await storage.delete(key)
    await expect(storage.open(key)).rejects.toThrow()
  })

  it('removes incomplete writes and rejects path traversal keys', async () => {
    const id = randomUUID()
    const key = `${id.slice(0, 2)}/${id}.bin`

    await expect(
      storage.put(key, Readable.from([Buffer.from('longer')]), 3, 'application/octet-stream'),
    ).rejects.toThrow('Attachment body exceeds its declared size.')
    await expect(storage.open(key)).rejects.toThrow()
    await expect(storage.put(`../${id}.bin`, Readable.from([]), 0, 'application/octet-stream')).rejects.toThrow(
      'Invalid attachment storage key.',
    )
  })
})

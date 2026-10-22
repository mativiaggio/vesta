import { createHash, randomUUID } from 'node:crypto'
import { Transform, type Readable, type TransformCallback } from 'node:stream'
import { createNoteAttachmentSchema } from '../../../../packages/notes/src/attachment-contract.js'
import type { BlobStorage } from '../attachments/blob-storage.js'
import {
  authorizeNoteAttachmentUpload,
  createNoteAttachment,
  getNoteAttachment,
  listNoteAttachments,
  softDeleteNoteAttachment,
} from './note-attachment-repository.js'

function storageKey(attachmentId: string, fileName: string): string {
  const extension = fileName.match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]?.toLowerCase()
  return `${attachmentId.slice(0, 2)}/${randomUUID()}${extension ? `.${extension}` : ''}`
}

export class NoteAttachmentUploadError extends Error {
  constructor(readonly kind: 'storage' | 'size-mismatch') {
    super(kind)
  }
}

class UploadSizeError extends Error {}

class UploadMeter extends Transform {
  bytes = 0
  checksumSha256 = ''
  private readonly hash = createHash('sha256')

  constructor(private readonly expectedBytes: number) {
    super()
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.bytes += chunk.byteLength
    if (this.bytes > this.expectedBytes) {
      callback(new UploadSizeError())
      return
    }
    this.hash.update(chunk)
    callback(null, chunk)
  }

  override _flush(callback: TransformCallback): void {
    if (this.bytes !== this.expectedBytes) {
      callback(new UploadSizeError())
      return
    }
    this.checksumSha256 = this.hash.digest('hex')
    callback()
  }
}

export async function uploadNoteAttachment(
  storage: BlobStorage,
  userId: string,
  workspaceId: string,
  noteId: string,
  rawInput: unknown,
  createBody: () => Readable,
) {
  const parsed = createNoteAttachmentSchema.safeParse(rawInput)
  if (!parsed.success) return { kind: 'invalid' as const }
  const input = parsed.data
  const authorization = await authorizeNoteAttachmentUpload(
    userId,
    workspaceId,
    noteId,
    input.id,
    input.fileName,
    input.sizeBytes,
  )
  if (authorization.kind !== 'ready') return authorization

  const key = storageKey(input.id, input.fileName)
  const meter = new UploadMeter(input.sizeBytes)
  const body = createBody()
  body.on('error', (error) => meter.destroy(error))
  body.pipe(meter)
  try {
    await storage.put(key, meter, input.sizeBytes, input.contentType)
  } catch (error) {
    body.destroy()
    await storage.delete(key).catch(() => undefined)
    if (error instanceof UploadSizeError) throw new NoteAttachmentUploadError('size-mismatch')
    throw new NoteAttachmentUploadError('storage')
  }

  let result
  try {
    result = await createNoteAttachment({
      ...input,
      workspaceId,
      noteId,
      userId,
      checksumSha256: meter.checksumSha256,
      storageKey: key,
      now: new Date(),
    })
  } catch (error) {
    await storage.delete(key).catch(() => undefined)
    throw error
  }
  if (result.kind !== 'created') await storage.delete(key).catch(() => undefined)
  return result
}

export { getNoteAttachment, listNoteAttachments, softDeleteNoteAttachment }

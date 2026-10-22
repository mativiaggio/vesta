import type { Readable } from 'node:stream'

export interface BlobStorage {
  put(key: string, body: Readable, sizeBytes: number, contentType: string): Promise<void>
  open(key: string): Promise<Readable>
  delete(key: string): Promise<void>
}

import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, realpath, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import type { Readable } from 'node:stream'
import type { BlobStorage } from './blob-storage.js'

class SizeVerifier extends Transform {
  private bytesWritten = 0

  constructor(private readonly expectedBytes: number) {
    super()
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.bytesWritten += chunk.byteLength
    if (this.bytesWritten > this.expectedBytes) {
      callback(new Error('Attachment body exceeds its declared size.'))
      return
    }
    callback(null, chunk)
  }

  override _flush(callback: TransformCallback): void {
    callback(this.bytesWritten === this.expectedBytes ? undefined : new Error('Attachment body size is incomplete.'))
  }
}

function safeKeySegments(key: string): string[] {
  const segments = key.split('/')
  if (
    segments.length !== 2 ||
    !/^[a-f0-9]{2}$/.test(segments[0] ?? '') ||
    !/^[a-f0-9-]{36}(?:\.[a-z0-9]{1,10})?$/.test(segments[1] ?? '')
  ) {
    throw new Error('Invalid attachment storage key.')
  }
  return segments
}

export class FilesystemBlobStorage implements BlobStorage {
  private rootPromise: Promise<string> | null = null

  constructor(private readonly configuredRoot: string) {}

  async initialize(): Promise<void> {
    await this.root()
  }

  private root(): Promise<string> {
    this.rootPromise ??= (async () => {
      await mkdir(this.configuredRoot, { recursive: true })
      const metadata = await lstat(this.configuredRoot)
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error('Attachment storage root is unsafe.')
      return realpath(this.configuredRoot)
    })()
    return this.rootPromise
  }

  private async resolve(key: string, createParent: boolean): Promise<string> {
    const segments = safeKeySegments(key)
    const root = await this.root()
    const directory = path.join(root, segments[0])
    if (createParent) await mkdir(directory, { recursive: true })
    const directoryMetadata = await lstat(directory)
    if (directoryMetadata.isSymbolicLink() || !directoryMetadata.isDirectory()) {
      throw new Error('Attachment storage directory is unsafe.')
    }
    const resolvedDirectory = await realpath(directory)
    if (!resolvedDirectory.startsWith(`${root}${path.sep}`)) throw new Error('Attachment path escaped its root.')
    return path.join(directory, segments[1])
  }

  async put(key: string, body: Readable, sizeBytes: number, contentType: string): Promise<void> {
    // The MIME type is persisted in attachment metadata; filesystem blobs need no sidecar.
    void contentType
    const target = await this.resolve(key, true)
    const temporary = `${target}.tmp-${randomUUID()}`
    try {
      await pipeline(body, new SizeVerifier(sizeBytes), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
      await rename(temporary, target)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async open(key: string): Promise<Readable> {
    const target = await this.resolve(key, false)
    const metadata = await lstat(target)
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error('Attachment blob is unavailable.')
    const resolvedTarget = await realpath(target)
    const root = await this.root()
    if (!resolvedTarget.startsWith(`${root}${path.sep}`)) throw new Error('Attachment path escaped its root.')
    return createReadStream(target)
  }

  async delete(key: string): Promise<void> {
    await rm(await this.resolve(key, false), { force: true })
  }
}

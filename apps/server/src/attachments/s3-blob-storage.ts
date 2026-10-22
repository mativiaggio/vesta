import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'
import type { BlobStorage } from './blob-storage.js'

const mebibyte = 1024 * 1024
const gibibyte = 1024 * mebibyte
const maxS3SinglePutBytes = 5_000_000_000
const maxS3PartCount = 10_000
const maxS3PartBytes = 5 * gibibyte
const maxS3ObjectBytes = maxS3PartCount * maxS3PartBytes

type MultipartState = { pending: Buffer | null }

function multipartPartSize(sizeBytes: number): number {
  return Math.max(8 * mebibyte, Math.ceil(sizeBytes / maxS3PartCount / mebibyte) * mebibyte)
}

function createPartBody(chunks: AsyncIterator<Buffer>, state: MultipartState, partBytes: number): Readable {
  async function* readPart() {
    let remaining = partBytes
    while (remaining > 0) {
      if (!state.pending || state.pending.byteLength === 0) {
        const next = await chunks.next()
        if (next.done) throw new Error('Attachment body ended before the declared size.')
        state.pending = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value)
      }

      const current = state.pending
      const take = Math.min(remaining, current.byteLength)
      yield current.subarray(0, take)
      state.pending = take === current.byteLength ? null : current.subarray(take)
      remaining -= take
    }
  }
  return Readable.from(readPart())
}

export class S3BlobStorage implements BlobStorage {
  private readonly client: S3Client

  constructor(
    private readonly bucket: string,
    config: { region: string; endpoint?: string; forcePathStyle?: boolean },
  ) {
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle ?? false,
    })
  }

  async put(key: string, body: Readable, sizeBytes: number, contentType: string): Promise<void> {
    if (sizeBytes > maxS3ObjectBytes) throw new Error('The configured object storage cannot store a file this large.')
    if (sizeBytes <= maxS3SinglePutBytes) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentLength: sizeBytes,
          ContentType: contentType,
        }),
      )
      return
    }

    const created = await this.client.send(
      new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
    )
    if (!created.UploadId) throw new Error('S3 did not create a multipart upload.')

    const uploadId = created.UploadId
    const chunkIterator = body[Symbol.asyncIterator]() as AsyncIterator<Buffer>
    const chunkState: MultipartState = { pending: null }
    const completedParts: Array<{ ETag: string; PartNumber: number }> = []
    const partSize = multipartPartSize(sizeBytes)
    try {
      let uploadedBytes = 0
      let partNumber = 1
      while (uploadedBytes < sizeBytes) {
        const partBytes = Math.min(partSize, sizeBytes - uploadedBytes)
        const uploaded = await this.client.send(
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
            Body: createPartBody(chunkIterator, chunkState, partBytes),
            ContentLength: partBytes,
          }),
        )
        if (!uploaded.ETag) throw new Error('S3 did not confirm the uploaded part.')
        completedParts.push({ ETag: uploaded.ETag, PartNumber: partNumber })
        uploadedBytes += partBytes
        partNumber += 1
      }

      const trailing = await chunkIterator.next()
      if (!trailing.done || chunkState.pending) throw new Error('Attachment body exceeds its declared size.')
      await this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: completedParts },
        }),
      )
    } catch (error) {
      await this.client
        .send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId }))
        .catch(() => undefined)
      throw error
    }
  }

  async open(key: string): Promise<Readable> {
    const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    if (!object.Body) throw new Error('Attachment blob is unavailable.')
    return object.Body as Readable
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }
}

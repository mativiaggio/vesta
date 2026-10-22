import type { serverConfig } from '../config.js'
import type { BlobStorage } from './blob-storage.js'
import { FilesystemBlobStorage } from './filesystem-blob-storage.js'
import { S3BlobStorage } from './s3-blob-storage.js'

type StorageConfig = typeof serverConfig.attachmentStorage

export async function createBlobStorage(config: StorageConfig): Promise<BlobStorage> {
  if (config.backend === 's3') {
    if (!config.bucket || !config.region) throw new Error('S3 attachment storage is not configured.')
    return new S3BlobStorage(config.bucket, {
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
    })
  }
  if (!config.directory) throw new Error('Filesystem attachment storage is not configured.')
  const storage = new FilesystemBlobStorage(config.directory)
  await storage.initialize()
  return storage
}

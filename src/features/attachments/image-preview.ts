const imageTypesByExtension: Record<string, string> = {
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
}

const previewableImageTypes = new Set(Object.values(imageTypesByExtension))

export function attachmentImageType(fileName: string, contentType: string): string | null {
  const normalizedContentType = contentType.toLowerCase()
  if (previewableImageTypes.has(normalizedContentType)) return normalizedContentType
  if (normalizedContentType !== 'application/octet-stream') return null
  const extension = fileName.split('.').at(-1)?.toLowerCase() ?? ''
  return imageTypesByExtension[extension] ?? null
}

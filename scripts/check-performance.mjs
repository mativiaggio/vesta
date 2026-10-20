import { gzipSync } from 'node:zlib'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const outputDirectory = resolve('dist')
const manifest = JSON.parse(await readFile(resolve(outputDirectory, '.vite/manifest.json'), 'utf8'))
const entry = Object.values(manifest).find((chunk) => chunk.isEntry)
if (!entry) throw new Error('Vite manifest does not contain the application entry point.')

const visited = new Set()
async function collectInitialJavaScript(chunk) {
  if (visited.has(chunk.file)) return 0
  visited.add(chunk.file)
  const bytes = gzipSync(await readFile(resolve(outputDirectory, chunk.file))).byteLength
  let total = bytes
  for (const importedKey of chunk.imports ?? []) {
    const imported = manifest[importedKey]
    if (!imported) throw new Error(`Missing imported chunk ${importedKey} in Vite manifest.`)
    total += await collectInitialJavaScript(imported)
  }
  return total
}

const initialJavaScriptGzipBytes = await collectInitialJavaScript(entry)
const budgetBytes = 220 * 1024
if (initialJavaScriptGzipBytes > budgetBytes) {
  throw new Error(`Initial JavaScript is ${Math.ceil(initialJavaScriptGzipBytes / 1024)} KiB gzip; budget is 220 KiB.`)
}

process.stdout.write(
  `Initial JavaScript: ${Math.ceil(initialJavaScriptGzipBytes / 1024)} KiB gzip (budget: 220 KiB).\n`,
)

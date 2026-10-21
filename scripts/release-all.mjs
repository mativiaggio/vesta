import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseArguments = process.argv.slice(2)
// npm 11 consumes unknown --flags as npm config and exposes them as npm_config_*.
const officialRelease = releaseArguments.includes('--official') || process.env.npm_config_official === 'true'
const versionArguments = releaseArguments.filter((argument) => argument !== '--official')
const requestedVersion = versionArguments[0]
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

if (
  !requestedVersion ||
  !versionPattern.test(requestedVersion) ||
  versionArguments.length !== 1 ||
  releaseArguments.some((argument) => argument.startsWith('--') && argument !== '--official')
) {
  fail(
    'Usage: npm run release:all -- <major.minor.patch> [--official] (example: npm run release:all -- 0.1.5 --official)',
  )
}

if (process.platform !== 'win32') {
  fail('release:all currently builds the Windows NSIS installer and must be run on Windows.')
}

function readJson(path) {
  return JSON.parse(readFileSync(join(projectRoot, path), 'utf8'))
}

function jsonWithVersion(path, update) {
  const fullPath = join(projectRoot, path)
  const original = readFileSync(fullPath, 'utf8')
  const parsed = JSON.parse(original)
  update(parsed)
  const newline = original.includes('\r\n') ? '\r\n' : '\n'
  return { path: fullPath, contents: `${JSON.stringify(parsed, null, 2).replaceAll('\n', newline)}${newline}` }
}

function bumpPackageToml(contents) {
  const lines = contents.split(/\r?\n/)
  let inPackageTable = false
  let versionWasUpdated = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s*\[/.test(line)) inPackageTable = line.trim() === '[package]'
    if (inPackageTable && /^version\s*=\s*"[^"]+"\s*$/.test(line)) {
      lines[index] = line.replace(/"[^"]+"/, `"${requestedVersion}"`)
      versionWasUpdated = true
      break
    }
  }

  if (!versionWasUpdated) throw new Error('Could not find [package].version in src-tauri/Cargo.toml.')
  return lines.join(contents.includes('\r\n') ? '\r\n' : '\n')
}

function bumpCargoLock(contents) {
  const lines = contents.split(/\r?\n/)
  let inVestaPackage = false
  let packageWasUpdated = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    if (line === '[[package]]') {
      inVestaPackage = false
    } else if (line === 'name = "vesta"') {
      inVestaPackage = true
    } else if (inVestaPackage && /^version\s*=/.test(line)) {
      if (!/^version\s*=\s*"[^"]+"$/.test(line)) {
        throw new Error('The vesta package version in src-tauri/Cargo.lock has an unsupported format.')
      }
      lines[index] = lines[index].replace(/"[^"]+"/, `"${requestedVersion}"`)
      packageWasUpdated = true
      break
    }
  }

  if (!packageWasUpdated) throw new Error('Could not find the vesta package in src-tauri/Cargo.lock.')
  return lines.join(contents.includes('\r\n') ? '\r\n' : '\n')
}

try {
  const packageJson = readJson('package.json')
  const currentVersion = packageJson.version
  if (!versionPattern.test(currentVersion)) throw new Error(`Invalid current package version: ${currentVersion}`)
  const currentParts = currentVersion.split('.').map(Number)
  const requestedParts = requestedVersion.split('.').map(Number)
  let versionComparison = 0
  for (let index = 0; index < currentParts.length; index += 1) {
    if (requestedParts[index] === currentParts[index]) continue
    versionComparison = requestedParts[index] < currentParts[index] ? -1 : 1
    break
  }
  if (versionComparison < 0) {
    throw new Error(`Version ${requestedVersion} is lower than the current version ${currentVersion}.`)
  }

  const packageJsonFile = jsonWithVersion('package.json', (json) => {
    json.version = requestedVersion
  })
  const packageLockFile = jsonWithVersion('package-lock.json', (json) => {
    if (!json.packages?.['']) throw new Error('package-lock.json is missing packages[""] metadata.')
    json.version = requestedVersion
    json.packages[''].version = requestedVersion
  })
  const tauriConfigFile = jsonWithVersion('src-tauri/tauri.conf.json', (json) => {
    json.version = requestedVersion
  })

  const cargoTomlPath = join(projectRoot, 'src-tauri/Cargo.toml')
  const cargoLockPath = join(projectRoot, 'src-tauri/Cargo.lock')
  const cargoToml = readFileSync(cargoTomlPath, 'utf8')
  const cargoLock = readFileSync(cargoLockPath, 'utf8')
  const updates = [
    packageJsonFile,
    packageLockFile,
    { path: cargoTomlPath, contents: bumpPackageToml(cargoToml) },
    { path: cargoLockPath, contents: bumpCargoLock(cargoLock) },
    tauriConfigFile,
  ]

  for (const update of updates) writeFileSync(update.path, update.contents, 'utf8')
  process.stdout.write(`Updated package and Tauri version metadata to ${requestedVersion}.\n`)

  const tauriCliPath = join(projectRoot, 'node_modules/@tauri-apps/cli/tauri.js')
  const build = spawnSync(process.execPath, [tauriCliPath, 'build', '--bundles', 'nsis'], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
  })
  if (build.error) throw build.error
  if (build.status !== 0) process.exit(build.status ?? 1)

  const bundleDirectory = join(projectRoot, 'src-tauri/target/release/bundle/nsis')
  const installers = readdirSync(bundleDirectory)
    .filter((file) => file.startsWith(`Vesta_${requestedVersion}_`) && file.endsWith('-setup.exe'))
    .map((file) => join(bundleDirectory, file))
  if (installers.length === 0) throw new Error('Build completed but no NSIS setup executable was found.')

  process.stdout.write(`\nInstaller${installers.length === 1 ? '' : 's'}:\n${installers.join('\n')}\n`)

  if (officialRelease) {
    const officialAssetsDirectory = join(projectRoot, 'release-assets/official')
    mkdirSync(officialAssetsDirectory, { recursive: true })
    const stagedInstallers = installers.map((installer) => {
      const destination = join(officialAssetsDirectory, basename(installer))
      copyFileSync(installer, destination)
      return destination
    })
    process.stdout.write(
      `\nOfficial GitHub release asset${stagedInstallers.length === 1 ? '' : 's'} staged at:\n${stagedInstallers.join('\n')}\n`,
    )
  }
} catch (error) {
  if (error instanceof Error) fail(error.message)
  throw error
}

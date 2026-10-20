import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

const baseDatabaseUrl = process.env.DATABASE_URL
if (!baseDatabaseUrl) throw new Error('DATABASE_URL is required for database integration tests.')

const databaseName = `vesta_integration_${process.pid}_${randomBytes(4).toString('hex')}`
if (!/^vesta_integration_[a-z0-9_]+$/.test(databaseName)) throw new Error('Unsafe integration database name.')

const integrationUrl = new URL(baseDatabaseUrl)
integrationUrl.pathname = `/${databaseName}`
const adminPool = new pg.Pool({ connectionString: baseDatabaseUrl, max: 1 })
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('npm_execpath is required to run database integration tests.')

function run(command, args, environment) {
  const result = spawnSync(command, args, { env: environment, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 'unknown'}.`)
}

try {
  await adminPool.query(`CREATE DATABASE "${databaseName}"`)
  const environment = {
    ...process.env,
    DATABASE_URL: integrationUrl.toString(),
    TEST_DATABASE_URL: integrationUrl.toString(),
  }
  run(process.execPath, [npmCli, 'run', 'db:migrate'], environment)
  run(
    process.execPath,
    [npmCli, 'exec', '--', 'vitest', 'run', '--config', 'vitest.integration.config.ts'],
    environment,
  )
} finally {
  await adminPool.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [databaseName],
  )
  await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
  await adminPool.end()
}

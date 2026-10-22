import 'dotenv/config'
import { resolve } from 'node:path'
import { z } from 'zod'

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DEPLOYMENT_MODE: z.enum(['self-hosted', 'cloud']),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.string().url(),
    AUTH_TRUSTED_ORIGINS: z.string().min(1),
    RESEND_API_KEY: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional()),
    EMAIL_FROM: z.preprocess((value) => (value === '' ? undefined : value), z.string().email().optional()),
    ENABLE_CONSOLE_PASSWORD_RESET: z.enum(['true', 'false']).default('false'),
    ATTACHMENT_STORAGE_BACKEND: z.enum(['s3', 'filesystem']).default('filesystem'),
    ATTACHMENT_STORAGE_DIRECTORY: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z
        .string()
        .trim()
        .min(1)
        .default(resolve(process.cwd(), '.vesta-data', 'attachments')),
    ),
    AWS_REGION: z.string().trim().min(1).optional(),
    AWS_S3_BUCKET: z.string().trim().min(1).optional(),
    AWS_S3_ENDPOINT: z.preprocess((value) => (value === '' ? undefined : value), z.string().url().optional()),
    AWS_S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),
  })
  .superRefine((config, context) => {
    if (config.DEPLOYMENT_MODE === 'cloud' && new URL(config.BETTER_AUTH_URL).protocol !== 'https:') {
      context.addIssue({
        code: 'custom',
        message: 'Cloud mode requires BETTER_AUTH_URL to use HTTPS.',
        path: ['BETTER_AUTH_URL'],
      })
    }

    if (config.DEPLOYMENT_MODE === 'cloud' && (!config.RESEND_API_KEY || !config.EMAIL_FROM)) {
      context.addIssue({
        code: 'custom',
        message: 'Cloud mode requires RESEND_API_KEY and EMAIL_FROM.',
        path: ['RESEND_API_KEY'],
      })
    }

    if (config.DEPLOYMENT_MODE === 'cloud' && config.ENABLE_CONSOLE_PASSWORD_RESET === 'true') {
      context.addIssue({
        code: 'custom',
        message: 'Console password reset delivery is forbidden in cloud mode.',
        path: ['ENABLE_CONSOLE_PASSWORD_RESET'],
      })
    }

    if (config.DEPLOYMENT_MODE === 'cloud' && config.ATTACHMENT_STORAGE_BACKEND !== 's3') {
      context.addIssue({
        code: 'custom',
        message: 'Cloud mode requires S3 attachment storage.',
        path: ['ATTACHMENT_STORAGE_BACKEND'],
      })
    }

    if (config.ATTACHMENT_STORAGE_BACKEND === 'filesystem') {
      if (!/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(config.ATTACHMENT_STORAGE_DIRECTORY)) {
        context.addIssue({
          code: 'custom',
          message: 'ATTACHMENT_STORAGE_DIRECTORY must be an absolute path.',
          path: ['ATTACHMENT_STORAGE_DIRECTORY'],
        })
      }
    }

    if (config.ATTACHMENT_STORAGE_BACKEND === 's3' && (!config.AWS_REGION || !config.AWS_S3_BUCKET)) {
      context.addIssue({
        code: 'custom',
        message: 'S3 attachment storage requires AWS_REGION and AWS_S3_BUCKET.',
        path: ['AWS_S3_BUCKET'],
      })
    }

    if (
      config.DEPLOYMENT_MODE === 'cloud' &&
      config.AWS_S3_ENDPOINT &&
      new URL(config.AWS_S3_ENDPOINT).protocol !== 'https:'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Cloud mode requires AWS_S3_ENDPOINT to use HTTPS.',
        path: ['AWS_S3_ENDPOINT'],
      })
    }

    const origins = config.AUTH_TRUSTED_ORIGINS.split(',').map((origin) => origin.trim())
    if (origins.some((origin) => origin === '*')) {
      context.addIssue({
        code: 'custom',
        message: 'Wildcard trusted origins are not allowed.',
        path: ['AUTH_TRUSTED_ORIGINS'],
      })
    }

    if (
      origins.some((origin) => {
        try {
          const parsedOrigin = new URL(origin)
          return (
            (parsedOrigin.pathname !== '' && parsedOrigin.pathname !== '/') ||
            parsedOrigin.search !== '' ||
            parsedOrigin.hash !== ''
          )
        } catch {
          return true
        }
      })
    ) {
      context.addIssue({
        code: 'custom',
        message: 'AUTH_TRUSTED_ORIGINS must be a comma-separated list of exact origins without paths.',
        path: ['AUTH_TRUSTED_ORIGINS'],
      })
    }
  })

const parsed = configSchema.safeParse(process.env)

if (!parsed.success) {
  throw new Error(`Invalid server configuration: ${JSON.stringify(z.treeifyError(parsed.error))}`)
}

const config = parsed.data

export const serverConfig = {
  nodeEnv: config.NODE_ENV,
  port: config.PORT,
  databaseUrl: config.DATABASE_URL,
  authSecret: config.BETTER_AUTH_SECRET,
  authUrl: config.BETTER_AUTH_URL,
  trustedOrigins: config.AUTH_TRUSTED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  deploymentMode: config.DEPLOYMENT_MODE,
  resendApiKey: config.RESEND_API_KEY,
  emailFrom: config.EMAIL_FROM,
  enableConsolePasswordReset: config.ENABLE_CONSOLE_PASSWORD_RESET === 'true',
  attachmentStorage: {
    backend: config.ATTACHMENT_STORAGE_BACKEND,
    directory: config.ATTACHMENT_STORAGE_DIRECTORY,
    region: config.AWS_REGION,
    bucket: config.AWS_S3_BUCKET,
    endpoint: config.AWS_S3_ENDPOINT,
    forcePathStyle: config.AWS_S3_FORCE_PATH_STYLE === 'true',
  },
}

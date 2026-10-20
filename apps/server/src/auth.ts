import { betterAuth } from 'better-auth'
import { pool } from '../../../packages/database/src/client.js'
import { serverConfig } from './config.js'
import { createEmailDelivery } from './email/create-delivery.js'
import { createAuthDatabaseAdapter } from './auth-database-adapter.js'

const emailDelivery = createEmailDelivery()
const hiddenDeletedAtField = {
  type: 'date',
  required: false,
  input: false,
  returned: false,
} as const

export const auth = betterAuth({
  appName: 'Vesta',
  baseURL: serverConfig.authUrl,
  basePath: '/api/auth',
  secret: serverConfig.authSecret,
  database: createAuthDatabaseAdapter,
  trustedOrigins: serverConfig.trustedOrigins,
  user: { additionalFields: { deletedAt: hiddenDeletedAtField } },
  account: { additionalFields: { deletedAt: hiddenDeletedAtField } },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      if (!emailDelivery) {
        throw new Error('Password recovery is not configured. Set up Resend or explicitly enable the self-hosted administrative console fallback.')
      }

      await emailDelivery.sendPasswordReset({ email: user.email, resetUrl: url })
    },
  },
  verification: {
    additionalFields: { deletedAt: hiddenDeletedAtField },
    storeIdentifier: {
      default: 'plain',
      overrides: { 'reset-password:': 'hashed' },
    },
  },
  session: {
    additionalFields: { deletedAt: hiddenDeletedAtField },
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: false },
  },
  advanced: {
    useSecureCookies: serverConfig.nodeEnv === 'production',
    defaultCookieAttributes: {
      sameSite: 'none',
      secure: true,
    },
  },
  onAPIError: {
    onError() {
      process.stderr.write('[auth] Request failed.\n')
    },
  },
})

export async function closeAuthDatabase(): Promise<void> {
  await pool.end()
}

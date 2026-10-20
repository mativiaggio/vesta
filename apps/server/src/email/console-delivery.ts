import type { EmailDelivery, PasswordResetMessage } from './delivery.js'

export class AdministrativeConsoleEmailDelivery implements EmailDelivery {
  sendPasswordReset({ email, resetUrl }: PasswordResetMessage): Promise<void> {
    process.stderr.write(`\n[ADMIN ONLY] Password reset URL for ${email} (single-use; expires soon):\n${resetUrl}\n\n`)
    return Promise.resolve()
  }
}

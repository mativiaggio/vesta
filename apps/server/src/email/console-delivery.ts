import type { EmailDelivery, PasswordResetMessage } from './delivery.js'

export class AdministrativeConsoleEmailDelivery implements EmailDelivery {
  async sendPasswordReset({ email, resetUrl }: PasswordResetMessage): Promise<void> {
    process.stderr.write(
      `\n[ADMIN ONLY] Password reset URL for ${email} (single-use; expires soon):\n${resetUrl}\n\n`,
    )
  }
}

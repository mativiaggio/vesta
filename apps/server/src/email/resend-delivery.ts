import { Resend } from 'resend'
import type { EmailDelivery, PasswordResetMessage } from './delivery.js'

export class ResendEmailDelivery implements EmailDelivery {
  private readonly client: Resend

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey)
  }

  async sendPasswordReset({ email, resetUrl }: PasswordResetMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: email,
      subject: 'Reset your Vesta password',
      text: `Use this one-time link to choose a new Vesta password. It expires soon.\n\n${resetUrl}`,
      html: `<p>Use this one-time link to choose a new Vesta password. It expires soon.</p><p><a href="${escapeHtml(resetUrl)}">Reset password</a></p>`,
    })

    if (error) {
      throw new Error(`Password reset email delivery failed: ${error.message}`)
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

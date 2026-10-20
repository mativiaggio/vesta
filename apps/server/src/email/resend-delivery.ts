import { Resend } from 'resend'
import type { EmailDelivery, PasswordResetMessage } from './delivery.js'
import { createPasswordResetContent } from './password-reset-content.js'

export class ResendEmailDelivery implements EmailDelivery {
  private readonly client: Resend

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey)
  }

  async sendPasswordReset(message: PasswordResetMessage): Promise<void> {
    const content = createPasswordResetContent(message)
    const { error } = await this.client.emails.send({
      from: this.from,
      to: message.email,
      ...content,
    })

    if (error) {
      throw new Error(`Password reset email delivery failed: ${error.message}`)
    }
  }
}

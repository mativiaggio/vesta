export type PasswordResetMessage = {
  email: string
  resetUrl: string
  language: 'en' | 'es'
}

export interface EmailDelivery {
  sendPasswordReset(message: PasswordResetMessage): Promise<void>
}

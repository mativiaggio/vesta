export type PasswordResetMessage = {
  email: string
  resetUrl: string
}

export interface EmailDelivery {
  sendPasswordReset(message: PasswordResetMessage): Promise<void>
}

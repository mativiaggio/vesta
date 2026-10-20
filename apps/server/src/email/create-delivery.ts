import { serverConfig } from '../config.js'
import type { EmailDelivery } from './delivery.js'
import { AdministrativeConsoleEmailDelivery } from './console-delivery.js'
import { ResendEmailDelivery } from './resend-delivery.js'

export function createEmailDelivery(): EmailDelivery | null {
  if (serverConfig.resendApiKey && serverConfig.emailFrom) {
    return new ResendEmailDelivery(serverConfig.resendApiKey, serverConfig.emailFrom)
  }

  if (serverConfig.deploymentMode === 'self-hosted' && serverConfig.enableConsolePasswordReset) {
    return new AdministrativeConsoleEmailDelivery()
  }

  return null
}

import type { PasswordResetMessage } from './delivery.js'

const copy = {
  en: {
    subject: 'Reset your Vesta password',
    introduction: 'Use this one-time link to choose a new Vesta password. It expires in one hour.',
    action: 'Reset password',
  },
  es: {
    subject: 'Restablece tu contraseña de Vesta',
    introduction: 'Usa este enlace de un solo uso para elegir una nueva contraseña de Vesta. Vence en una hora.',
    action: 'Restablecer contraseña',
  },
} as const

export function createPasswordResetContent(message: PasswordResetMessage) {
  const localized = copy[message.language]
  return {
    subject: localized.subject,
    text: `${localized.introduction}\n\n${localized.action}: ${message.resetUrl}`,
    html: `<p>${localized.introduction}</p><p><a href="${escapeHtml(message.resetUrl)}">${localized.action}</a></p>`,
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  )
}

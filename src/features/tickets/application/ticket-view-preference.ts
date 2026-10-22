import { readPreference, writePreference } from '../../preferences/preference-store'

export type TicketView = 'table' | 'kanban'
export type TicketDetailPresentation = 'modal' | 'fullscreen'

const storageKey = 'vesta.tickets-view'
const detailPresentationStorageKey = 'vesta.ticket-detail-presentation'
let detailPresentationWriteQueue: Promise<void> = Promise.resolve()

export async function loadTicketViewPreference(): Promise<TicketView> {
  return (await readPreference(storageKey)) === 'kanban' ? 'kanban' : 'table'
}

export function saveTicketViewPreference(view: TicketView): Promise<void> {
  return writePreference(storageKey, view)
}

export async function loadTicketDetailPresentationPreference(): Promise<TicketDetailPresentation> {
  return (await readPreference(detailPresentationStorageKey)) === 'fullscreen' ? 'fullscreen' : 'modal'
}

export function saveTicketDetailPresentationPreference(presentation: TicketDetailPresentation): Promise<void> {
  const write = detailPresentationWriteQueue.then(() => writePreference(detailPresentationStorageKey, presentation))
  detailPresentationWriteQueue = write.catch(() => undefined)
  return write
}

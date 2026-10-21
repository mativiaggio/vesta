import { invoke } from '@tauri-apps/api/core'
import { z } from 'zod'
import type { PreferenceStorageAdapter } from '../../preferences/preference-store'

export const localDesktopPreferenceStorage: PreferenceStorageAdapter = {
  async read(key) {
    const value: unknown = await invoke('get_local_preference', { key })
    return z.string().nullable().parse(value)
  },
  async write(key, value) {
    await invoke('set_local_preference', { key, value })
  },
}

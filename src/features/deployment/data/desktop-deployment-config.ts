import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { z } from 'zod'

const desktopSetupSchema = z
  .object({
    configVersion: z.literal(1),
    mode: z.literal('self-managed'),
    dataDirectory: z.string().min(1),
  })
  .strict()

export type DesktopSetup = z.infer<typeof desktopSetupSchema>

export async function loadDesktopSetup(): Promise<DesktopSetup | null> {
  const result: unknown = await invoke('get_desktop_setup')
  if (result === null) return null
  return desktopSetupSchema.parse(result)
}

export async function loadDefaultDataDirectory(): Promise<string> {
  const result: unknown = await invoke('get_default_data_directory')
  return z.string().min(1).parse(result)
}

export async function chooseDataDirectory(defaultPath: string, title: string): Promise<string | null> {
  const result = await open({
    title,
    directory: true,
    multiple: false,
    defaultPath,
  })

  if (typeof result === 'string') return result
  if (Array.isArray(result)) return result[0] ?? null
  return null
}

export async function saveSelfManagedSetup(dataDirectory: string): Promise<DesktopSetup> {
  const result: unknown = await invoke('save_self_managed_setup', { dataDirectory })
  return desktopSetupSchema.parse(result)
}

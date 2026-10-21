import { describe, expect, it } from 'vitest'
import { resolveApiBaseUrl } from './api-base-url'

describe('resolveApiBaseUrl', () => {
  it('uses the configured origin for a desktop build', () => {
    expect(
      resolveApiBaseUrl({
        configuredUrl: 'https://api.example.test/',
        currentOrigin: 'http://tauri.localhost',
        isDevelopment: false,
      }),
    ).toBe('https://api.example.test')
  })

  it('uses the local API during development', () => {
    expect(
      resolveApiBaseUrl({
        currentOrigin: 'http://localhost:5173',
        isDevelopment: true,
      }),
    ).toBe('http://localhost:3000')
  })

  it('uses the current origin for a production web build', () => {
    expect(
      resolveApiBaseUrl({
        currentOrigin: 'https://vesta.example.test',
        isDevelopment: false,
      }),
    ).toBe('https://vesta.example.test')
  })

  it('uses the packaged app origin when local desktop does not need an API', () => {
    expect(
      resolveApiBaseUrl({
        currentOrigin: 'http://tauri.localhost',
        isDevelopment: false,
      }),
    ).toBe('http://tauri.localhost')
  })
})

import { describe, expect, it } from 'vitest'
import { resolveApiBaseUrl } from './api-base-url'

describe('resolveApiBaseUrl', () => {
  it('uses the configured origin for a desktop build', () => {
    expect(
      resolveApiBaseUrl({
        configuredUrl: 'https://api.example.test/',
        currentOrigin: 'http://tauri.localhost',
        isDevelopment: false,
        isDesktop: true,
      }),
    ).toBe('https://api.example.test')
  })

  it('uses the local API during development', () => {
    expect(
      resolveApiBaseUrl({
        currentOrigin: 'http://localhost:5173',
        isDevelopment: true,
        isDesktop: false,
      }),
    ).toBe('http://localhost:3000')
  })

  it('uses the current origin for a production web build', () => {
    expect(
      resolveApiBaseUrl({
        currentOrigin: 'https://vesta.example.test',
        isDevelopment: false,
        isDesktop: false,
      }),
    ).toBe('https://vesta.example.test')
  })

  it('rejects a packaged desktop build without an API origin', () => {
    expect(() =>
      resolveApiBaseUrl({
        currentOrigin: 'http://tauri.localhost',
        isDevelopment: false,
        isDesktop: true,
      }),
    ).toThrow('VITE_API_URL is required')
  })
})

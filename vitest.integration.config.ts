import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['apps/server/src/**/*.integration.test.ts'],
    maxWorkers: 1,
  },
})

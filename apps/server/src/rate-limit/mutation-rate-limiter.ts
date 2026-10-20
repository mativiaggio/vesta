export type MutationRateLimitPolicy = {
  suffix: string
  windowMs: number
  max: number
}

export type MutationRateLimitDecision = {
  allowed: boolean
  retryAfterSeconds: number
}

export interface MutationRateLimiter {
  consume(scopeKey: string, policies: readonly MutationRateLimitPolicy[]): Promise<MutationRateLimitDecision>
}

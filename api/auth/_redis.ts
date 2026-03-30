import { Redis } from '@upstash/redis'

export interface StoredCredentials {
  tokenUrl: string
  clientId: string
  clientSecret: string
  audience: string
  validatorAudience?: string
}

export function getRedis(): Redis {
  return new Redis({
    url: (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)!,
    token: (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)!,
  })
}

export function kvKey(nodeId: string): string {
  return `canton:creds:${nodeId}`
}

export async function getStoredCredentials(nodeId: string): Promise<StoredCredentials | null> {
  const redis = getRedis()
  return redis.get<StoredCredentials>(kvKey(nodeId))
}

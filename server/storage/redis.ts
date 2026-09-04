import { Redis } from '@upstash/redis'
import type { TemplateStorage, TemplateIndex, CronMeta, NodeAuthConfig } from './interface.js'

export class RedisStorage implements TemplateStorage {
  private redis: Redis

  constructor() {
    this.redis = new Redis({
      url: (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)!,
      token: (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)!,
    })
  }

  async getTemplateIndex(network: string): Promise<TemplateIndex | null> {
    return this.redis.get<TemplateIndex>(`canton:templates:${network}`)
  }

  async setTemplateIndex(network: string, data: TemplateIndex): Promise<void> {
    await this.redis.set(`canton:templates:${network}`, data)
  }

  async getCronMeta(): Promise<CronMeta | null> {
    return this.redis.get<CronMeta>('canton:cron:meta')
  }

  async setCronMeta(meta: CronMeta): Promise<void> {
    await this.redis.set('canton:cron:meta', meta)
  }

  async getLastRunTimestamp(): Promise<number | null> {
    return this.redis.get<number>('canton:cron:lastRunTs')
  }

  async setLastRunTimestamp(ts: number): Promise<void> {
    await this.redis.set('canton:cron:lastRunTs', ts)
  }

  async acquireLock(ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set('canton:cron:lock', 'running', { nx: true, ex: ttlSeconds })
    return !!result
  }

  async releaseLock(): Promise<void> {
    await this.redis.del('canton:cron:lock')
  }

  async getCredentials(nodeId: string): Promise<NodeAuthConfig | null> {
    return this.redis.get<NodeAuthConfig>(`canton:creds:${nodeId}`)
  }
}

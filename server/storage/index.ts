import type { TemplateStorage } from './interface.js'

let storageInstance: TemplateStorage | null = null

export async function getStorage(): Promise<TemplateStorage> {
  if (storageInstance) return storageInstance

  if (process.env.DATABASE_URL) {
    const { PostgresStorage } = await import('./postgres.js')
    storageInstance = new PostgresStorage(process.env.DATABASE_URL)
    return storageInstance
  }

  const { RedisStorage } = await import('./redis.js')
  storageInstance = new RedisStorage()
  return storageInstance
}

export type { TemplateStorage, TemplateIndex, TemplateEntry, CronMeta, NodeAuthConfig } from './interface.js'
